-- Access of the debtors, what the review of lot O left open (docs/api.md, « Accès débiteur »):
-- * a counter by debtor as well as by identifier: an individual with many cases has as many references, and each of them
--   gave ten more tries at the same code. Ten failures in all on the identifiers of one debtor now block them;
-- * the alert beyond 200 failures an hour in all (question 114): told to the Director and the Developer, once an hour at most.

ALTER TYPE notification_kind ADD VALUE 'DEBTOR_ACCESS_ALERT';

GRANT CREATE ON SCHEMA app TO legarec_definer;
SET LOCAL ROLE legarec_definer;

-- As before (20261126040000_debtor_access), with a second counter: the one of the debtor the identifier names, kept in
-- `lockouts` under a fingerprint of their id (an unknown identifier has one of its own, under a fingerprint of the
-- identifier: the same work whatever the identifier). The answer stays the one of the identifier typed: answering by the
-- counter of the debtor would tell that two references belong to the same person, and that an unknown one does not. Once
-- the debtor counts ten failures, the code is no longer compared on any of their identifiers until it is renewed; the block
-- is told once, whichever counter reaches ten first.
CREATE OR REPLACE FUNCTION app.debtor_sign_in(wanted_kind text, wanted_value text, attempt bytea, typed bytea, hash bytea, remembered boolean, address inet,
  OUT outcome text, OUT attempts_left integer, OUT minutes integer, OUT debtor uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  named uuid;
  announced boolean;
  known public.lockouts;
  whole public.lockouts;
  whole_key bytea;
  counted integer;
  counted_whole integer;
  was_blocked boolean;
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
  -- Locked always in this order (the identifier, then the debtor): two tries at the same time never wait for each other.
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
  whole_key := sha256(convert_to('debtor-access:' || coalesce(named::text, encode(attempt, 'hex')), 'UTF8'));
  INSERT INTO public.lockouts (key_hash, scope, failures) VALUES (whole_key, 'DEBTOR'::text::public.attempt_scope, 0) ON CONFLICT (key_hash) DO NOTHING;
  SELECT * INTO whole FROM public.lockouts l WHERE l.key_hash = whole_key FOR UPDATE;
  IF named IS NOT NULL AND whole.debtor_id IS DISTINCT FROM named THEN
    UPDATE public.lockouts l SET debtor_id = named WHERE l.key_hash = whole_key;
  END IF;
  was_blocked := whole.blocked_at IS NOT NULL;
  IF announced AND NOT was_blocked AND EXISTS (SELECT 1 FROM public.debtor_access_codes a WHERE a.debtor_id = named AND a.code_hmac = typed) THEN
    DELETE FROM public.lockouts l WHERE l.key_hash IN (attempt, whole_key);
    INSERT INTO public.debtor_sessions (debtor_id, token_hash, ip, persistent, expires_at) VALUES (named, hash, address, remembered, now() + interval '12 hours');
    PERFORM app.log('DEBTOR_SIGNED_IN', NULL, NULL, '{}');
    outcome := 'OPEN';
    debtor := named;
    RETURN;
  END IF;
  counted := CASE WHEN known.failures < 5 AND known.last_failure_at < now() - interval '24 hours' THEN 0 ELSE known.failures END + 1;
  counted_whole := CASE WHEN whole.failures < 5 AND whole.last_failure_at < now() - interval '24 hours' THEN 0 ELSE whole.failures END + 1;
  UPDATE public.lockouts l SET failures = counted, last_failure_at = now(),
    locked_until = CASE WHEN counted = 5 THEN now() + interval '15 minutes' END,
    blocked_at = CASE WHEN counted >= 10 THEN now() END
  WHERE l.key_hash = attempt;
  UPDATE public.lockouts l SET failures = counted_whole, last_failure_at = now(),
    blocked_at = coalesce(whole.blocked_at, CASE WHEN counted_whole >= 10 OR counted >= 10 THEN now() END)
  WHERE l.key_hash = whole_key;
  IF NOT was_blocked AND (counted_whole >= 10 OR counted >= 10) THEN
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
  END IF;
  IF counted >= 10 THEN
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

-- Beyond 200 failures an hour in all (counted in Valkey, by the API): told in the application to the Director and the
-- Developer. The API calls it once an episode; the database keeps it to one an hour whatever calls it. True when told.
CREATE FUNCTION app.debtor_access_alert() RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'ANONYMOUS' THEN
    PERFORM app.refuse('42501');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('debtor-access-alert', 0));
  IF EXISTS (SELECT 1 FROM public.notifications n WHERE n.kind::text = 'DEBTOR_ACCESS_ALERT' AND n.created_at > now() - interval '1 hour') THEN
    RETURN false;
  END IF;
  INSERT INTO public.notifications (user_id, kind, actor_id, target_id)
  SELECT u.id, 'DEBTOR_ACCESS_ALERT'::text::public.notification_kind, u.id, u.id FROM public.users u WHERE u.role IN ('DIRECTOR', 'DEVELOPER') AND u.status = 'ACTIVE';
  PERFORM app.log('DEBTOR_ACCESS_ALERT', NULL, NULL, '{}');
  RETURN true;
END
$$;
GRANT EXECUTE ON FUNCTION app.debtor_access_alert() TO legarec_auth;
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM legarec_definer;
CREATE POLICY definer_read_debtor_access_alert ON notifications FOR SELECT TO legarec_definer USING (kind::text = 'DEBTOR_ACCESS_ALERT');
