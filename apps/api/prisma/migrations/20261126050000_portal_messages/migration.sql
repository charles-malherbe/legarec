-- Messages of the space of the debtor: between the debtor and the team, on one case. What the debtor writes never keeps their
-- access code (the API takes it out before this table). Their files are documents of the case, analysed before anyone reads them.

CREATE TYPE message_side AS ENUM ('DEBTOR', 'STAFF');
CREATE TYPE debtor_request_kind AS ENUM ('PLAN', 'DISPUTE', 'ALREADY_PAID', 'CALLBACK');

CREATE TABLE portal_messages (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  case_id uuid NOT NULL,
  creditor_id uuid NOT NULL,
  side message_side NOT NULL,
  author_id uuid REFERENCES users (id),
  text text NOT NULL CHECK (length(btrim(text)) BETWEEN 1 AND 5000),
  request_kind debtor_request_kind,
  -- Facts of a guided request: months, a day, an amount in cents, a means, a slot (never a phone number: it is in `text`).
  request_data jsonb CHECK (request_data IS NULL OR (jsonb_typeof(request_data) = 'object' AND octet_length(request_data::text) <= 500)),
  read_by_staff_at timestamptz(3),
  read_by_debtor_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  FOREIGN KEY (case_id, creditor_id) REFERENCES cases (id, creditor_id),
  UNIQUE (id, case_id),
  CONSTRAINT portal_messages_author CHECK ((side = 'STAFF') = (author_id IS NOT NULL)),
  CONSTRAINT portal_messages_request CHECK (request_kind IS NULL OR side = 'DEBTOR')
);
CREATE INDEX portal_messages_case ON portal_messages (case_id, created_at);

CREATE TABLE portal_message_attachments (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  case_id uuid NOT NULL,
  creditor_id uuid NOT NULL,
  message_id uuid NOT NULL,
  document_id uuid NOT NULL UNIQUE,
  FOREIGN KEY (case_id, creditor_id) REFERENCES cases (id, creditor_id),
  FOREIGN KEY (message_id, case_id) REFERENCES portal_messages (id, case_id),
  FOREIGN KEY (document_id, case_id) REFERENCES documents (id, case_id)
);

-- A file sent by a debtor before their message: theirs, of no case yet, until the message takes it.
ALTER TABLE documents ADD COLUMN uploaded_by_debtor uuid REFERENCES debtors (id),
  ADD CONSTRAINT documents_debtor_upload CHECK ((source = 'DEBTOR') = (uploaded_by_debtor IS NOT NULL));

GRANT CREATE ON SCHEMA app TO legarec_definer;
GRANT SELECT, INSERT, UPDATE (read_by_staff_at, read_by_debtor_at) ON portal_messages TO legarec_definer;
GRANT SELECT, INSERT ON portal_message_attachments TO legarec_definer;
GRANT SELECT (id, case_id, creditor_id, source, uploaded_by_debtor, created_at, scan_status),
  INSERT (id, category, kind, title, original_name, storage_key, size_bytes, sha256, source, uploaded_by_debtor), UPDATE (case_id, creditor_id) ON documents TO legarec_definer;
GRANT SELECT (id, debtor_id, creditor_id, status, closed_on, first_letter_on, officer_id), UPDATE (status, version) ON cases TO legarec_definer;
SET LOCAL ROLE legarec_definer;

-- The code of the debtor who is signed in, and its key: so that the API takes it out of what they write.
CREATE FUNCTION app.own_access_code() RETURNS TABLE (debtor_id uuid, code_cipher bytea, key_id uuid, key_cipher bytea)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT a.debtor_id, a.code_cipher, k.id, k.value_cipher
  FROM public.debtor_access_codes a
  LEFT JOIN public.vault_secrets k ON k.name = 'ACCESS_CODE_KEY' AND k.kind = 'INTERNAL' AND k.status <> 'REVOKED'
  WHERE app.actor_kind() = 'DEBTOR' AND a.debtor_id = app.debtor_id()
$$;

-- A file of the debtor, kept until their message takes it (or the purge of the files of no case, lot X).
CREATE FUNCTION app.debtor_upload(wanted_id uuid, wanted_kind document_kind, wanted_key text, size integer, fingerprint text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'DEBTOR' OR app.debtor_id() IS NULL THEN
    PERFORM app.refuse('42501');
  END IF;
  -- Twenty files waiting at most.
  IF (SELECT count(*) FROM public.documents d WHERE d.uploaded_by_debtor = app.debtor_id() AND d.case_id IS NULL) >= 20 THEN
    PERFORM app.refuse('LG409');
  END IF;
  INSERT INTO public.documents (id, category, kind, title, original_name, storage_key, size_bytes, sha256, source, uploaded_by_debtor)
  VALUES (wanted_id, 'EVIDENCE', wanted_kind, 'Pièce envoyée par le débiteur', 'piece-du-debiteur.' || lower(wanted_kind::text), wanted_key, size, fingerprint, 'DEBTOR', app.debtor_id());
END
$$;

-- A message of the debtor on one of their announced cases, with their files; a request is written as a message too. A
-- dispute puts the case in dispute (the scenario stops, lot Q).
CREATE FUNCTION app.debtor_message(target uuid, wanted_text text, files uuid[], kind debtor_request_kind, facts jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  held record;
  added uuid := app.uuid_v7();
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'DEBTOR' THEN
    PERFORM app.refuse('42501');
  END IF;
  SELECT c.id, c.creditor_id, c.status INTO held FROM public.cases c
  WHERE c.id = target AND c.debtor_id = app.debtor_id() AND c.first_letter_on IS NOT NULL AND c.closed_on IS NULL;
  IF NOT FOUND THEN
    PERFORM app.refuse('LG404');
  END IF;
  IF cardinality(coalesce(files, '{}')) > 20 OR (SELECT count(*) FROM public.documents d WHERE d.id = ANY (coalesce(files, '{}'))
      AND d.uploaded_by_debtor = app.debtor_id() AND d.case_id IS NULL) <> cardinality(coalesce(files, '{}')) THEN
    PERFORM app.refuse('LG409');
  END IF;
  INSERT INTO public.portal_messages (id, case_id, creditor_id, side, text, request_kind, request_data)
  VALUES (added, target, held.creditor_id, 'DEBTOR', wanted_text, kind, facts);
  UPDATE public.documents d SET case_id = target, creditor_id = held.creditor_id WHERE d.id = ANY (coalesce(files, '{}'));
  INSERT INTO public.portal_message_attachments (case_id, creditor_id, message_id, document_id)
  SELECT target, held.creditor_id, added, file FROM unnest(coalesce(files, '{}')) AS file;
  IF kind = 'DISPUTE' AND held.status NOT IN ('DISPUTE', 'LITIGATION', 'SETTLED', 'LOST') THEN
    UPDATE public.cases c SET status = 'DISPUTE', version = c.version + 1 WHERE c.id = target;
  END IF;
  INSERT INTO public.case_events (case_id, creditor_id, kind, title, tone, actor_kind, actor_label)
  VALUES (target, held.creditor_id, 'PORTAL_MESSAGE', CASE kind WHEN 'PLAN' THEN 'Demande d’échéancier du débiteur' WHEN 'DISPUTE' THEN 'Contestation du débiteur'
    WHEN 'ALREADY_PAID' THEN 'Le débiteur déclare avoir payé' WHEN 'CALLBACK' THEN 'Demande de rappel du débiteur' ELSE 'Message du débiteur' END,
    CASE WHEN kind = 'DISPUTE' THEN 'warning' ELSE 'info' END::event_tone, 'DEBTOR', 'débiteur');
  RETURN added;
END
$$;

-- Read: by the debtor on their side, by whoever acts on the case on the other.
CREATE FUNCTION app.read_portal_messages(target uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF app.actor_kind() = 'DEBTOR' THEN
    UPDATE public.portal_messages m SET read_by_debtor_at = now()
    WHERE m.case_id = target AND m.side = 'STAFF' AND m.read_by_debtor_at IS NULL
      AND EXISTS (SELECT 1 FROM public.cases c WHERE c.id = target AND c.debtor_id = app.debtor_id() AND c.first_letter_on IS NOT NULL);
  ELSIF app.actor_kind() = 'STAFF' THEN
    UPDATE public.portal_messages m SET read_by_staff_at = now()
    WHERE m.case_id = target AND m.side = 'DEBTOR' AND m.read_by_staff_at IS NULL
      AND EXISTS (SELECT 1 FROM public.cases c WHERE c.id = target AND app.can_act_on_case(c.officer_id));
  ELSE
    PERFORM app.refuse('42501');
  END IF;
END
$$;

-- An answer of the team, in its own name, on a case it acts on and that the debtor was told of.
CREATE FUNCTION app.staff_message(target uuid, wanted_text text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  held record;
  added uuid := app.uuid_v7();
BEGIN
  SELECT c.id, c.creditor_id INTO held FROM public.cases c
  WHERE c.id = target AND app.actor_kind() = 'STAFF' AND app.can_act_on_case(c.officer_id) AND c.closed_on IS NULL;
  IF NOT FOUND THEN
    PERFORM app.refuse('42501');
  END IF;
  INSERT INTO public.portal_messages (id, case_id, creditor_id, side, author_id, text) VALUES (added, target, held.creditor_id, 'STAFF', app.user_id(), wanted_text);
  PERFORM app.add_case_event(target, 'PORTAL_ANSWER', 'Réponse dans l’espace débiteur', NULL, 'info', false);
  RETURN added;
END
$$;
GRANT EXECUTE ON FUNCTION app.own_access_code(), app.debtor_upload(uuid, document_kind, text, integer, text), app.debtor_message(uuid, text, uuid[], debtor_request_kind, jsonb)
  TO legarec_debtor;
GRANT EXECUTE ON FUNCTION app.read_portal_messages(uuid) TO legarec_debtor, legarec_staff;
GRANT EXECUTE ON FUNCTION app.staff_message(uuid, text) TO legarec_staff;
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM legarec_definer;

CALL app.secure_case_table('portal_messages', ARRAY['debtor']);
CREATE POLICY definer_all ON portal_messages TO legarec_definer USING (true) WITH CHECK (true);
GRANT SELECT (id, case_id, creditor_id, side, author_id, text, request_kind, request_data, read_by_staff_at, read_by_debtor_at, created_at) ON portal_messages TO legarec_staff, legarec_worker;
GRANT SELECT (id, case_id, creditor_id, side, text, request_kind, read_by_staff_at, read_by_debtor_at, created_at) ON portal_messages TO legarec_debtor;

CALL app.secure_case_table('portal_message_attachments', ARRAY['debtor']);
CREATE POLICY definer_all ON portal_message_attachments TO legarec_definer USING (true) WITH CHECK (true);
GRANT SELECT (id, case_id, creditor_id, message_id, document_id) ON portal_message_attachments TO legarec_staff, legarec_worker, legarec_debtor;

-- The files of the debtor: theirs while they wait, then those of the case; the team never sees one waiting.
CREATE POLICY definer_upload ON documents TO legarec_definer USING (true) WITH CHECK (true);
CREATE POLICY debtor_own ON documents FOR SELECT TO legarec_debtor USING (uploaded_by_debtor = (SELECT app.debtor_id()));
GRANT SELECT (uploaded_by_debtor) ON documents TO legarec_staff, legarec_worker;
GRANT SELECT (scan_status, source) ON documents TO legarec_debtor;
CREATE POLICY staff_not_waiting ON documents AS RESTRICTIVE FOR SELECT TO legarec_staff USING (uploaded_by_debtor IS NULL OR case_id IS NOT NULL);
