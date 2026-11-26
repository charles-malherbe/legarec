-- Access of the debtors to paiement.legarec.fr: an identifier (SIREN, or the reference of the case for an individual) and the
-- four letters of their code. No account: a session of the debtor, opened by the sign-in, read again at each request.

ALTER TYPE attempt_scope ADD VALUE 'DEBTOR';
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
GRANT SELECT (debtor_id, code_cipher) ON debtor_access_codes TO legarec_definer;
GRANT SELECT (id, name, value_cipher, kind, status) ON vault_secrets TO legarec_definer;
GRANT SELECT (id, kind, siren) ON debtors TO legarec_definer;
GRANT SELECT (id, reference, debtor_id, first_letter_on, closed_on, officer_id, creditor_id) ON cases TO legarec_definer;
SET LOCAL ROLE legarec_definer;

-- The debtor that an identifier names, with an announced case still open: by SIREN for a company or a sole trader, by the
-- reference of a case for an individual only. With its code and the key that opens it. Nothing for anyone else.
CREATE FUNCTION app.debtor_for_access(wanted_kind text, wanted_value text)
RETURNS TABLE (debtor_id uuid, code_cipher bytea, key_id uuid, key_cipher bytea)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT d.id, a.code_cipher, k.id, k.value_cipher
  FROM public.debtors d
  JOIN public.debtor_access_codes a ON a.debtor_id = d.id
  LEFT JOIN public.vault_secrets k ON k.name = 'ACCESS_CODE_KEY' AND k.kind = 'INTERNAL' AND k.status <> 'REVOKED'
  WHERE app.actor_kind() = 'ANONYMOUS'
    AND CASE wanted_kind
      WHEN 'SIREN' THEN d.siren = wanted_value AND d.kind <> 'INDIVIDUAL'
      WHEN 'REFERENCE' THEN d.kind = 'INDIVIDUAL' AND EXISTS (SELECT 1 FROM public.cases r WHERE r.reference = wanted_value AND r.debtor_id = d.id)
      ELSE false
    END
    AND EXISTS (SELECT 1 FROM public.cases c WHERE c.debtor_id = d.id AND c.first_letter_on IS NOT NULL AND c.closed_on IS NULL)
  LIMIT 1
$$;

-- Counted before the code is checked. Five failures: 15 minutes; ten: blocked until the code is renewed. A day without a
-- failure starts again from zero, a block never does.
CREATE FUNCTION app.debtor_attempt(wanted bytea, OUT state text, OUT attempts_left integer, OUT minutes integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  known public.lockouts;
  counted integer;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'ANONYMOUS' THEN
    PERFORM app.refuse('42501');
  END IF;
  INSERT INTO public.lockouts (key_hash, scope, failures) VALUES (wanted, 'DEBTOR'::text::public.attempt_scope, 0) ON CONFLICT (key_hash) DO NOTHING;
  SELECT * INTO known FROM public.lockouts l WHERE l.key_hash = wanted FOR UPDATE;
  IF known.blocked_at IS NOT NULL THEN
    state := 'BLOCKED';
    RETURN;
  END IF;
  IF known.locked_until > now() THEN
    state := 'LOCKED';
    minutes := ceil(extract(epoch FROM known.locked_until - now()) / 60)::integer;
    RETURN;
  END IF;
  counted := CASE WHEN known.last_failure_at < now() - interval '24 hours' THEN 0 ELSE known.failures END + 1;
  UPDATE public.lockouts l SET failures = counted, last_failure_at = now(),
    locked_until = CASE WHEN counted = 5 THEN now() + interval '15 minutes' END,
    blocked_at = CASE WHEN counted >= 10 THEN now() END
  WHERE l.key_hash = wanted;
  state := CASE WHEN counted >= 10 THEN 'BLOCKS' WHEN counted = 5 THEN 'LOCKS' ELSE 'TAKEN' END;
  attempts_left := CASE WHEN counted < 5 THEN 5 - counted ELSE 10 - counted END;
  minutes := CASE WHEN counted = 5 THEN 15 END;
END
$$;

-- The identifier named that debtor.
CREATE FUNCTION app.mark_debtor_attempt(attempt bytea, debtor uuid) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  UPDATE public.lockouts SET debtor_id = debtor WHERE key_hash = attempt AND scope::text = 'DEBTOR' AND app.actor_kind() = 'ANONYMOUS'
$$;

-- The right code: what was counted is forgotten, and a session opens.
CREATE FUNCTION app.open_debtor_session(debtor uuid, attempt bytea, hash bytea, remembered boolean, address inet, until timestamptz) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'ANONYMOUS' THEN
    PERFORM app.refuse('42501');
  END IF;
  DELETE FROM public.lockouts l WHERE l.key_hash = attempt AND l.blocked_at IS NULL;
  INSERT INTO public.debtor_sessions (debtor_id, token_hash, ip, persistent, expires_at) VALUES (debtor, hash, address, remembered, until);
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

-- A blocked access is told to the officers of the open cases of that debtor, in the history of each case (docs/api.md).
CREATE FUNCTION app.note_debtor_blocked(debtor uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'ANONYMOUS' THEN
    PERFORM app.refuse('42501');
  END IF;
  INSERT INTO public.case_events (case_id, creditor_id, kind, title, detail, tone, actor_kind, actor_label)
  SELECT c.id, c.creditor_id, 'DEBTOR_ACCESS_BLOCKED', 'Accès du débiteur bloqué', 'Dix codes faux : régénérez le code pour le débloquer.', 'danger', 'SYSTEM', 'automatique'
  FROM public.cases c WHERE c.debtor_id = debtor AND c.closed_on IS NULL;
  INSERT INTO public.notifications (user_id, kind, actor_id, target_id, case_id, creditor_id, case_count)
  SELECT c.officer_id, 'DEBTOR_BLOCKED', c.officer_id, c.officer_id, c.id, c.creditor_id, 1
  FROM public.cases c WHERE c.debtor_id = debtor AND c.closed_on IS NULL AND c.officer_id IS NOT NULL;
END
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
GRANT EXECUTE ON FUNCTION app.debtor_for_access(text, text), app.debtor_attempt(bytea), app.open_debtor_session(uuid, bytea, bytea, boolean, inet, timestamptz),
  app.resume_debtor_session(bytea, boolean), app.close_debtor_session(bytea), app.note_debtor_blocked(uuid), app.mark_debtor_attempt(bytea, uuid) TO legarec_auth;
GRANT EXECUTE ON FUNCTION app.forget_debtor_access(uuid) TO legarec_staff;
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM legarec_definer;

ALTER TYPE notification_kind ADD VALUE 'DEBTOR_BLOCKED';
ALTER TABLE notifications DROP CONSTRAINT notifications_case,
  ADD CONSTRAINT notifications_case CHECK (case_id IS NULL OR (creditor_id IS NOT NULL AND kind::text IN ('CASE_ASSIGNED', 'PLAN_DECIDED', 'DEBTOR_BLOCKED')));

CALL app.secure('debtor_sessions');
CREATE POLICY definer_all ON debtor_sessions TO legarec_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_debtor ON lockouts TO legarec_definer USING (scope::text = 'DEBTOR') WITH CHECK (scope::text = 'DEBTOR');
CREATE POLICY definer_codes ON debtor_access_codes FOR SELECT TO legarec_definer USING (true);
CREATE POLICY definer_keys ON vault_secrets FOR SELECT TO legarec_definer USING (kind = 'INTERNAL' AND name = 'ACCESS_CODE_KEY');

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
