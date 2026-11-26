-- Access of the debtors to paiement.legarec.fr: an identifier (SIREN, or the reference of the case for an individual) and the
-- four letters of their code. No account: a session of the debtor, opened by the sign-in, read again at each request.

ALTER TYPE attempt_scope ADD VALUE 'DEBTOR';
-- Keyed fingerprint of the code in force (key derived from VAULT_MASTER_KEY): the sign-in compares it without opening the code.
ALTER TABLE debtor_access_codes ADD COLUMN code_hmac bytea;
-- Ten failures: blocked until the code is renewed (never purged meanwhile, docs/api.md « Accès débiteur »).
ALTER TABLE lockouts ADD COLUMN blocked_at timestamptz(3),
  -- The debtor an identifier was found to name: renewing their code forgets what was counted on any of their identifiers.
  ADD COLUMN debtor_id uuid REFERENCES debtors (id);

CREATE TABLE debtor_sessions (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  debtor_id uuid NOT NULL REFERENCES debtors (id),
  token_hash bytea NOT NULL UNIQUE,
  ip inet,
  persistent boolean NOT NULL DEFAULT false,
  last_seen_at timestamptz(3) NOT NULL DEFAULT now(),
  expires_at timestamptz(3) NOT NULL,
  revoked_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX debtor_sessions_debtor ON debtor_sessions (debtor_id) WHERE revoked_at IS NULL;

GRANT CREATE ON SCHEMA app TO legarec_definer;
GRANT SELECT, INSERT, UPDATE (revoked_at, last_seen_at) ON debtor_sessions TO legarec_definer;
GRANT SELECT (key_hash, scope, failures, last_failure_at, locked_until, blocked_at, debtor_id), INSERT (key_hash, scope, failures), UPDATE (failures, last_failure_at, locked_until, blocked_at, debtor_id),
  DELETE ON lockouts TO legarec_definer;
GRANT SELECT (debtor_id, code_hmac), UPDATE (code_hmac) ON debtor_access_codes TO legarec_definer;
GRANT SELECT (id, reference, debtor_id, first_letter_on, closed_on, officer_id, creditor_id) ON cases TO legarec_definer;
SET LOCAL ROLE legarec_definer;

-- The whole sign-in of a debtor, in one call: the same work whatever the identifier. The code is compared to a keyed
-- fingerprint of the code in force (`code_hmac`, written by the team), never read here. A try is counted under the lock of
-- its counter: two tries at the same time are one after the other. Five failures: 15 minutes; ten: blocked until the code
-- is renewed, told to the officers. Ten failures spread over days still block: only fewer than five are forgotten after a
-- day. The counter is tied to the debtor the identifier names, announced or not, so that a new code lifts any block.
CREATE FUNCTION app.debtor_sign_in(wanted_kind text, wanted_value text, attempt bytea, typed bytea, hash bytea, remembered boolean, address inet,
  OUT outcome text, OUT attempts_left integer, OUT minutes integer, OUT debtor uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  named uuid;
  announced boolean;
  known public.lockouts;
  counted integer;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'ANONYMOUS' THEN
    PERFORM app.refuse('42501');
  END IF;
  SELECT d.id INTO named FROM public.debtors d
  WHERE CASE wanted_kind
    WHEN 'SIREN' THEN d.siren = wanted_value AND d.kind <> 'INDIVIDUAL'
    WHEN 'REFERENCE' THEN d.kind = 'INDIVIDUAL' AND d.id = (SELECT r.debtor_id FROM public.cases r WHERE r.reference = wanted_value)
    ELSE false
  END;
  announced := named IS NOT NULL AND EXISTS (SELECT 1 FROM public.cases c WHERE c.debtor_id = named AND c.first_letter_on IS NOT NULL AND c.closed_on IS NULL);
  INSERT INTO public.lockouts (key_hash, scope, failures) VALUES (attempt, 'DEBTOR'::text::public.attempt_scope, 0) ON CONFLICT (key_hash) DO NOTHING;
  SELECT * INTO known FROM public.lockouts l WHERE l.key_hash = attempt FOR UPDATE;
  IF named IS NOT NULL AND known.debtor_id IS DISTINCT FROM named THEN
    UPDATE public.lockouts l SET debtor_id = named WHERE l.key_hash = attempt;
  END IF;
  IF known.blocked_at IS NOT NULL THEN
    outcome := 'BLOCKED';
    RETURN;
  END IF;
  IF known.locked_until > now() THEN
    outcome := 'LOCKED';
    minutes := ceil(extract(epoch FROM known.locked_until - now()) / 60)::integer;
    RETURN;
  END IF;
  IF announced AND EXISTS (SELECT 1 FROM public.debtor_access_codes a WHERE a.debtor_id = named AND a.code_hmac = typed) THEN
    DELETE FROM public.lockouts l WHERE l.key_hash = attempt;
    INSERT INTO public.debtor_sessions (debtor_id, token_hash, ip, persistent, expires_at) VALUES (named, hash, address, remembered, now() + interval '12 hours');
    PERFORM app.log('DEBTOR_SIGNED_IN', NULL, NULL, '{}');
    outcome := 'OPEN';
    debtor := named;
    RETURN;
  END IF;
  counted := CASE WHEN known.failures < 5 AND known.last_failure_at < now() - interval '24 hours' THEN 0 ELSE known.failures END + 1;
  UPDATE public.lockouts l SET failures = counted, last_failure_at = now(),
    locked_until = CASE WHEN counted = 5 THEN now() + interval '15 minutes' END,
    blocked_at = CASE WHEN counted >= 10 THEN now() END
  WHERE l.key_hash = attempt;
  IF counted >= 10 THEN
    IF named IS NOT NULL THEN
      INSERT INTO public.case_events (case_id, creditor_id, kind, title, detail, tone, actor_kind, actor_label)
      SELECT c.id, c.creditor_id, 'DEBTOR_ACCESS_BLOCKED', 'Accès du débiteur bloqué', 'Dix codes faux : régénérez le code pour le débloquer.', 'danger', 'SYSTEM', 'automatique'
      FROM public.cases c WHERE c.debtor_id = named AND c.closed_on IS NULL;
      -- To the officer of each case; without one, to the manager, who holds the cases of nobody.
      INSERT INTO public.notifications (user_id, kind, actor_id, target_id, case_id, creditor_id, case_count)
      SELECT w.id, 'DEBTOR_BLOCKED', w.id, w.id, c.id, c.creditor_id, 1
      FROM public.cases c JOIN public.users w ON w.id = coalesce(c.officer_id, (SELECT m.id FROM public.users m WHERE m.role = 'COLLECTION_MANAGER' AND m.status = 'ACTIVE'))
      WHERE c.debtor_id = named AND c.closed_on IS NULL;
    END IF;
    PERFORM app.log('DEBTOR_ACCESS_BLOCKED', NULL, NULL, '{}');
    outcome := 'BLOCKED';
  ELSIF counted = 5 THEN
    outcome := 'LOCKED';
    minutes := 15;
  ELSE
    outcome := 'INVALID';
    attempts_left := CASE WHEN counted < 5 THEN 5 - counted ELSE 10 - counted END;
  END IF;
END
$$;

-- The fingerprint of the code in force, written by whoever acts on a case of that debtor when the code is drawn or shown.
CREATE FUNCTION app.set_code_hmac(debtor uuid, fingerprint bytea) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'STAFF' OR NOT EXISTS (SELECT 1 FROM public.cases c WHERE c.debtor_id = debtor AND app.can_act_on_case(c.officer_id)) THEN
    PERFORM app.refuse('42501');
  END IF;
  UPDATE public.debtor_access_codes a SET code_hmac = fingerprint WHERE a.debtor_id = debtor;
END
$$;

-- The session of a cookie: open, used within 30 minutes, and the debtor still with an announced case open.
CREATE FUNCTION app.resume_debtor_session(hash bytea, touch boolean) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  found_session public.debtor_sessions;
BEGIN
  SELECT * INTO found_session FROM public.debtor_sessions s
  WHERE s.token_hash = hash AND s.revoked_at IS NULL AND s.expires_at > now() AND s.last_seen_at > now() - interval '30 minutes'
    AND EXISTS (SELECT 1 FROM public.cases c WHERE c.debtor_id = s.debtor_id AND c.first_letter_on IS NOT NULL AND c.closed_on IS NULL);
  IF found_session.id IS NULL THEN
    RETURN NULL;
  END IF;
  IF touch THEN
    UPDATE public.debtor_sessions s SET last_seen_at = now() WHERE s.id = found_session.id;
  END IF;
  RETURN found_session.debtor_id;
END
$$;

CREATE FUNCTION app.close_debtor_session(hash bytea) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  UPDATE public.debtor_sessions SET revoked_at = now() WHERE token_hash = hash AND revoked_at IS NULL
$$;

-- A code renewed opens again: the sessions of that debtor close, and the attempts counted on its identifiers are forgotten.
CREATE FUNCTION app.forget_debtor_access(debtor uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.cases c WHERE c.debtor_id = debtor AND app.can_act_on_case(c.officer_id)) THEN
    PERFORM app.refuse('42501');
  END IF;
  UPDATE public.debtor_sessions s SET revoked_at = now() WHERE s.debtor_id = debtor AND s.revoked_at IS NULL;
  DELETE FROM public.lockouts l WHERE l.debtor_id = debtor AND l.scope::text = 'DEBTOR';
END
$$;
GRANT EXECUTE ON FUNCTION app.debtor_sign_in(text, text, bytea, bytea, bytea, boolean, inet), app.resume_debtor_session(bytea, boolean), app.close_debtor_session(bytea)
  TO legarec_auth;
GRANT EXECUTE ON FUNCTION app.forget_debtor_access(uuid), app.set_code_hmac(uuid, bytea) TO legarec_staff;
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM legarec_definer;

ALTER TYPE notification_kind ADD VALUE 'DEBTOR_BLOCKED';
ALTER TABLE notifications DROP CONSTRAINT notifications_case,
  ADD CONSTRAINT notifications_case CHECK (case_id IS NULL OR (creditor_id IS NOT NULL AND kind::text IN ('CASE_ASSIGNED', 'PLAN_DECIDED', 'DEBTOR_BLOCKED')));

CALL app.secure('debtor_sessions');
CREATE POLICY definer_all ON debtor_sessions TO legarec_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_debtor ON lockouts TO legarec_definer USING (scope::text = 'DEBTOR') WITH CHECK (scope::text = 'DEBTOR');
CREATE POLICY definer_codes ON debtor_access_codes TO legarec_definer USING (true) WITH CHECK (true);

-- What the debtor reads to know what they owe: the interest terms of the mandate (never its fees), the rates of each
-- semester, the name of the creditor of their cases.
GRANT SELECT (mandate_id, formal_notice_on) ON cases TO legarec_debtor;
CREATE POLICY debtor_read ON mandates FOR SELECT TO legarec_debtor USING (id IN (SELECT c.mandate_id FROM public.cases c));
GRANT SELECT (id, creditor_id, interest_mode, contract_rate_bp, fixed_indemnity) ON mandates TO legarec_debtor;
CREATE POLICY debtor_read ON interest_rates FOR SELECT TO legarec_debtor USING (true);
GRANT SELECT (id, kind, valid_from, rate_bp) ON interest_rates TO legarec_debtor;
CREATE POLICY debtor_read ON creditors FOR SELECT TO legarec_debtor USING (id IN (SELECT c.creditor_id FROM public.cases c));
GRANT SELECT (id, name) ON creditors TO legarec_debtor;
-- How to pay: the account and the cheques of the firm, nothing else of its settings.
CREATE POLICY debtor_read ON settings FOR SELECT TO legarec_debtor
  USING (key IN ('firm.cabinet.holder', 'firm.cabinet.iban', 'firm.cabinet.bic', 'firm.cabinet.chequePayee', 'firm.cabinet.chequeAddress', 'firm.cabinet.name'));
GRANT SELECT (key, value) ON settings TO legarec_debtor;
-- From when the payments count for the installments of a plan.
GRANT SELECT (created_at) ON payment_plans TO legarec_debtor;

-- The counters of the debtors are theirs: the sign-in of the team never clears them, and the purge never lifts a block. The
-- sessions of the debtors go 48 hours after their end, as those of the team.
GRANT CREATE ON SCHEMA app TO legarec_definer;
GRANT SELECT (id, revoked_at, expires_at, last_seen_at), DELETE ON debtor_sessions TO legarec_definer;
SET LOCAL ROLE legarec_definer;
CREATE OR REPLACE FUNCTION app.clear_attempts(keys text[]) RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  DELETE FROM public.lockouts WHERE key_hash = ANY (app.digests(keys)) AND scope::text <> 'DEBTOR'
$$;
CREATE OR REPLACE FUNCTION app.purge_sign_ins() RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  removed integer := 0;
  batch integer;
BEGIN
  -- Never waiting for a line that someone else holds: it goes at the next purge.
  DELETE FROM public.auth_tokens WHERE id IN (SELECT t.id FROM public.auth_tokens t WHERE least(t.used_at, t.expires_at) < now() - interval '48 hours' FOR UPDATE SKIP LOCKED);
  GET DIAGNOSTICS batch = ROW_COUNT;
  removed := removed + batch;
  DELETE FROM public.user_sessions WHERE id IN (
    SELECT s.id FROM public.user_sessions s WHERE least(s.revoked_at, s.expires_at, s.last_seen_at + interval '30 minutes') < now() - interval '48 hours'
      AND NOT EXISTS (SELECT 1 FROM public.auth_tokens t WHERE t.session_id = s.id) FOR UPDATE SKIP LOCKED);
  GET DIAGNOSTICS batch = ROW_COUNT;
  removed := removed + batch;
  DELETE FROM public.debtor_sessions WHERE id IN (
    SELECT s.id FROM public.debtor_sessions s WHERE least(s.revoked_at, s.expires_at, s.last_seen_at + interval '30 minutes') < now() - interval '48 hours' FOR UPDATE SKIP LOCKED);
  GET DIAGNOSTICS batch = ROW_COUNT;
  removed := removed + batch;
  DELETE FROM public.user_devices WHERE expires_at < now();
  GET DIAGNOSTICS batch = ROW_COUNT;
  removed := removed + batch;
  -- A block of a debtor stays until their code is renewed (docs/api.md, « Accès débiteur »).
  DELETE FROM public.lockouts WHERE last_failure_at < now() - interval '1 year' AND blocked_at IS NULL;
  GET DIAGNOSTICS batch = ROW_COUNT;
  RETURN removed + batch;
END
$$;
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM legarec_definer;
