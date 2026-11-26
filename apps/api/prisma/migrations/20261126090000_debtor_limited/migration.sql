-- What the space of the debtor offers before any code: the link printed on a letter or sent by text message, which fills the
-- identifier in; the code asked again by text message; how to pay; a message to the firm, unverified.

CREATE TABLE debtor_links (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  debtor_id uuid NOT NULL REFERENCES debtors (id),
  case_id uuid NOT NULL,
  creditor_id uuid NOT NULL,
  -- 60 bits drawn when the letter or the text leaves (lot Q), kept as a keyed fingerprint: the link never carries the code.
  token_hash bytea NOT NULL UNIQUE,
  channel text NOT NULL CHECK (channel IN ('LETTER', 'SMS', 'EMAIL')),
  expires_at timestamptz(3) NOT NULL,
  revoked_at timestamptz(3),
  uses integer NOT NULL DEFAULT 0 CHECK (uses >= 0),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  FOREIGN KEY (case_id, creditor_id) REFERENCES cases (id, creditor_id)
);

-- From someone without a code: nothing is said of any case to them, and only the manager reads it (6 months).
CREATE TABLE limited_messages (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  sender_name text NOT NULL CHECK (length(btrim(sender_name)) BETWEEN 1 AND 120),
  sender_email text CHECK (length(sender_email) <= 254),
  claimed_reference text CHECK (length(claimed_reference) <= 40),
  text text NOT NULL CHECK (length(btrim(text)) BETWEEN 1 AND 5000),
  read_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX limited_messages_created ON limited_messages (created_at DESC);

GRANT CREATE ON SCHEMA app TO legarec_definer;
GRANT SELECT (id, debtor_id, case_id, token_hash, expires_at, revoked_at, uses), UPDATE (uses) ON debtor_links TO legarec_definer;
GRANT INSERT (sender_name, sender_email, claimed_reference, text) ON limited_messages TO legarec_definer;
GRANT SELECT (key, value) ON settings TO legarec_definer;
GRANT SELECT (kind, status, value_normalized) ON case_contacts TO legarec_definer;
SET LOCAL ROLE legarec_definer;

-- What a link fills in: the SIREN of a company, the reference of the case of an individual. Nothing for a link unknown,
-- expired or revoked, nor once the case is closed.
CREATE FUNCTION app.debtor_link(hash bytea, OUT kind text, OUT value text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  found_link record;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'ANONYMOUS' THEN
    PERFORM app.refuse('42501');
  END IF;
  SELECT l.id, d.kind AS debtor_kind, d.siren, c.reference INTO found_link
  FROM public.debtor_links l JOIN public.debtors d ON d.id = l.debtor_id JOIN public.cases c ON c.id = l.case_id
  WHERE l.token_hash = hash AND l.revoked_at IS NULL AND l.expires_at > now() AND c.closed_on IS NULL AND c.first_letter_on IS NOT NULL;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  UPDATE public.debtor_links l SET uses = l.uses + 1 WHERE l.id = found_link.id;
  IF found_link.debtor_kind = 'INDIVIDUAL' THEN
    kind := 'REFERENCE';
    value := found_link.reference;
  ELSE
    kind := 'SIREN';
    value := found_link.siren;
  END IF;
END
$$;

-- The code asked again by text message: queued only for a debtor with an announced case and a mobile number a colleague has
-- confirmed (question 112); the same answer otherwise. The worker sends it (lot R).
CREATE FUNCTION app.ask_code_by_sms(wanted_kind text, wanted_value text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  named uuid;
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
  IF named IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.cases c JOIN public.case_contacts k ON k.case_id = c.id
    WHERE c.debtor_id = named AND c.first_letter_on IS NOT NULL AND c.closed_on IS NULL AND k.kind = 'PHONE' AND k.status = 'VERIFIED' AND k.value_normalized ~ '^0[67]'
  ) THEN
    PERFORM app.enqueue('sms', 'access-code-sms', jsonb_build_object('debtor', named), NULL, NULL);
  END IF;
END
$$;

-- How to pay the firm: its account and its cheques, nothing else of its settings.
CREATE FUNCTION app.firm_payment_settings() RETURNS TABLE (key text, value jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT s.key, s.value FROM public.settings s
  WHERE s.key IN ('firm.cabinet.holder', 'firm.cabinet.iban', 'firm.cabinet.bic', 'firm.cabinet.chequePayee', 'firm.cabinet.chequeAddress', 'firm.cabinet.name')
$$;

CREATE FUNCTION app.limited_message(wanted_name text, email text, reference text, wanted_text text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'ANONYMOUS' THEN
    PERFORM app.refuse('42501');
  END IF;
  INSERT INTO public.limited_messages (sender_name, sender_email, claimed_reference, text) VALUES (btrim(wanted_name), nullif(btrim(email), ''), nullif(btrim(reference), ''), wanted_text);
END
$$;
GRANT EXECUTE ON FUNCTION app.debtor_link(bytea), app.ask_code_by_sms(text, text), app.firm_payment_settings(), app.limited_message(text, text, text, text) TO legarec_auth;
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM legarec_definer;

CALL app.secure_case_table('debtor_links');
CREATE POLICY definer_all ON debtor_links TO legarec_definer USING (true) WITH CHECK (true);
GRANT SELECT (id, debtor_id, case_id, creditor_id, channel, expires_at, revoked_at, uses, created_at) ON debtor_links TO legarec_staff;
GRANT SELECT (id, debtor_id, case_id, creditor_id, channel, expires_at, revoked_at, uses), INSERT (debtor_id, case_id, creditor_id, token_hash, channel, expires_at)
  ON debtor_links TO legarec_worker;

CALL app.secure('limited_messages');
CREATE POLICY definer_add ON limited_messages FOR INSERT TO legarec_definer WITH CHECK (true);
CREATE POLICY manager_read ON limited_messages FOR SELECT TO legarec_staff USING ((SELECT app.staff_role()) = 'COLLECTION_MANAGER');
CREATE POLICY manager_mark ON limited_messages FOR UPDATE TO legarec_staff USING ((SELECT app.staff_role()) = 'COLLECTION_MANAGER');
CREATE POLICY retention_purge ON limited_messages FOR DELETE TO legarec_retention USING (created_at < now() - interval '6 months');
CREATE POLICY retention_read ON limited_messages FOR SELECT TO legarec_retention USING (true);
GRANT SELECT (id, sender_name, sender_email, claimed_reference, text, read_at, created_at), UPDATE (read_at) ON limited_messages TO legarec_staff;
GRANT SELECT (id, created_at), DELETE ON limited_messages TO legarec_retention;
