-- Retention of the cases (docs/api.md, « Conservation ») and erasure at the request of a debtor (RGPD, article 17).
-- Five years after it closed, a case is anonymized: its history, its exchanges, its coordinates and its attachments go,
-- the files of the attachments are erased from the disk; its line stays, without the address of the debtor, because the
-- receipts, invoices, payments, remittances and signed payment plans that refer to it are kept ten years. A debtor
-- shared by several cases is anonymized with the last of them; its line stays, without name nor SIREN. The durations
-- are written in the functions.
--
-- What is erased is erased by app.forget_case() and app.forget_debtor() alone, owned by legarec_forgetter: a role
-- without login, member of nobody, whose rights serve these two functions only, and that only legarec_definer calls.
-- Every table attached to a case is listed in app.forget_case(): a table added later (litigation_files of lot U) is
-- added there too, by a new version of the function, with the rights of legarec_forgetter on it.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'legarec_forgetter') THEN
    RAISE EXCEPTION 'role legarec_forgetter missing: run bootstrap.sql again (legarec-roles) before the migrations';
  END IF;
END
$$;
GRANT USAGE ON SCHEMA public, app TO legarec_forgetter;

CREATE TYPE retention_class AS ENUM ('CASE', 'ACCOUNTING');

ALTER TABLE cases
  ADD COLUMN anonymized_at timestamptz(3),
  -- Shown, never used by the purge: app.anonymize_case() writes its own duration.
  ADD COLUMN purge_after date GENERATED ALWAYS AS ((closed_on + interval '5 years')::date) STORED;
CREATE INDEX cases_to_forget ON cases (closed_on) WHERE anonymized_at IS NULL AND closed_on IS NOT NULL;

-- Receipts, statements of remittances and signed payment plans are pieces of accounting: ten years, whatever becomes of
-- their case (question 169).
ALTER TABLE documents
  ADD COLUMN retention_class retention_class NOT NULL GENERATED ALWAYS AS (
    CASE WHEN category IN ('RECEIPT', 'REMITTANCE', 'PAYMENT_PLAN') THEN 'ACCOUNTING'::retention_class ELSE 'CASE'::retention_class END) STORED,
  -- Its file is erased: the line stays for what refers to it, without its names.
  ADD COLUMN purged_at timestamptz(3);
CREATE INDEX documents_purged ON documents (id) WHERE purged_at IS NOT NULL;

-- Nobody but the purge sees an erased document: lists and downloads leave it out by themselves.
CREATE POLICY not_purged ON documents AS RESTRICTIVE FOR SELECT TO legarec_staff, legarec_partner, legarec_debtor, legarec_worker USING (purged_at IS NULL);
-- Nor changes it again by a function (shared again, filed elsewhere).
CREATE POLICY not_purged_change ON documents AS RESTRICTIVE FOR UPDATE TO legarec_definer USING (purged_at IS NULL);

GRANT SELECT (anonymized_at, purge_after) ON cases TO legarec_staff, legarec_worker;
GRANT SELECT (retention_class, purged_at) ON documents TO legarec_staff, legarec_worker;
GRANT SELECT (anonymized_at) ON cases TO legarec_definer;

-- ---------------------------------------------------------------- What the forgetter erases, and nothing else

GRANT SELECT (case_id), DELETE ON case_events, case_contact_events, case_contacts, portal_message_attachments, portal_messages, planned_reminders,
  ai_suggestions TO legarec_forgetter;
GRANT SELECT (case_id, debtor_id), DELETE ON debtor_links TO legarec_forgetter;
GRANT SELECT (debtor_id), DELETE ON debtor_sessions, debtor_access_codes, debtor_retired_codes TO legarec_forgetter;
GRANT SELECT (case_id, accepted_ip, document_id), UPDATE (accepted_ip) ON payment_plans TO legarec_forgetter;
GRANT SELECT (case_id, reason), UPDATE (reason) ON plan_approvals TO legarec_forgetter;
GRANT SELECT (case_id, bounce_reason), UPDATE (bounce_reason) ON payments TO legarec_forgetter;
GRANT SELECT (document_id) ON receipts TO legarec_forgetter;
GRANT SELECT (id, case_id, purged_at, retention_class, uploaded_by_debtor),
  UPDATE (title, original_name, purged_at, visible_to_debtor, shared_with_creditor_at, shared_by) ON documents TO legarec_forgetter;
GRANT SELECT (id, debtor_id, anonymized_at), UPDATE (debtor_siret, debtor_address, debtor_postal_code, debtor_city, contact_name, contact_title,
  external_reference, deposited_name, anonymized_at) ON cases TO legarec_forgetter;
GRANT SELECT (id, anonymized_at), UPDATE (name, siren, legal_form_code, legal_form_source, legal_form_checked_at, anonymized_at) ON debtors TO legarec_forgetter;
GRANT SELECT (debtor_id), UPDATE (origin) ON gdpr_requests TO legarec_forgetter;
DO $$
DECLARE
  target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['cases', 'debtors', 'case_events', 'case_contact_events', 'case_contacts', 'portal_message_attachments', 'portal_messages',
    'planned_reminders', 'debtor_links', 'ai_suggestions', 'debtor_access_codes', 'debtor_retired_codes', 'debtor_sessions', 'payment_plans', 'plan_approvals',
    'payments', 'receipts', 'documents', 'gdpr_requests'] LOOP
    EXECUTE format('CREATE POLICY forgetter_all ON %I TO legarec_forgetter USING (true) WITH CHECK (true)', target);
  END LOOP;
END
$$;

-- The history and the journal of the coordinates stay append-only, but for the retention and for the forgetter.
CREATE OR REPLACE FUNCTION app.refuse_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- The forgetter may call nothing: its own case first.
    IF current_user = 'legarec_forgetter' THEN
      IF TG_TABLE_NAME IN ('case_events', 'case_contact_events') THEN
        RETURN OLD;
      END IF;
    ELSIF current_user = 'legarec_definer' AND app.setting('purging') = TG_TABLE_NAME THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION 'append-only table: %', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END
$$;

-- The files of the erased documents, removed from the disk by the purge (again after a restoration).
CREATE POLICY retention_files ON documents FOR SELECT TO legarec_retention USING (purged_at IS NOT NULL);
GRANT SELECT (id, storage_key, purged_at) ON documents TO legarec_retention;

-- ---------------------------------------------------------------- The forgetter

GRANT CREATE ON SCHEMA app TO legarec_forgetter;
SET LOCAL ROLE legarec_forgetter;
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- Everything a case holds about its debtor, but what accounting keeps ten years.
CREATE FUNCTION app.forget_case(target uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  DELETE FROM public.case_contact_events WHERE case_id = target;
  DELETE FROM public.case_events WHERE case_id = target;
  DELETE FROM public.case_contacts WHERE case_id = target;
  DELETE FROM public.portal_message_attachments WHERE case_id = target;
  DELETE FROM public.portal_messages WHERE case_id = target;
  DELETE FROM public.planned_reminders WHERE case_id = target;
  DELETE FROM public.debtor_links WHERE case_id = target;
  DELETE FROM public.ai_suggestions WHERE case_id = target;
  -- The plans and the payments stay; who accepted from where, why the firm decided, why a cheque bounced, go.
  UPDATE public.payment_plans SET accepted_ip = NULL WHERE case_id = target AND accepted_ip IS NOT NULL;
  UPDATE public.plan_approvals SET reason = NULL WHERE case_id = target AND reason IS NOT NULL;
  UPDATE public.payments SET bounce_reason = NULL WHERE case_id = target AND bounce_reason IS NOT NULL;
  -- The attachments, but the pieces of accounting (receipts, signed plans): their files go with the next purge.
  UPDATE public.documents d SET title = 'Pièce supprimée', original_name = 'piece-supprimee', purged_at = now(), visible_to_debtor = false,
    shared_with_creditor_at = NULL, shared_by = NULL
  WHERE d.case_id = target AND d.purged_at IS NULL AND d.retention_class = 'CASE'
    AND NOT EXISTS (SELECT 1 FROM public.receipts r WHERE r.document_id = d.id)
    AND NOT EXISTS (SELECT 1 FROM public.payment_plans p WHERE p.document_id = d.id);
  UPDATE public.cases c SET debtor_siret = NULL, debtor_address = NULL, debtor_postal_code = NULL, debtor_city = NULL, contact_name = NULL,
    contact_title = NULL, external_reference = NULL, deposited_name = NULL, anonymized_at = now()
  WHERE c.id = target;
END
$$;

-- A debtor once none of their cases names them any more: false, and nothing done, if one still does. Its line stays.
CREATE FUNCTION app.forget_debtor(person uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  -- After the cases (same order for the night and for an erasure); a case being opened for them waits, then is seen.
  PERFORM 1 FROM public.debtors d WHERE d.id = person AND d.anonymized_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RETURN true;
  END IF;
  IF EXISTS (SELECT 1 FROM public.cases c WHERE c.debtor_id = person AND c.anonymized_at IS NULL) THEN
    RETURN false;
  END IF;
  DELETE FROM public.debtor_sessions WHERE debtor_id = person;
  DELETE FROM public.debtor_links WHERE debtor_id = person;
  DELETE FROM public.debtor_access_codes WHERE debtor_id = person;
  DELETE FROM public.debtor_retired_codes WHERE debtor_id = person;
  -- Files sent by the debtor and never attached to a case.
  UPDATE public.documents d SET title = 'Pièce supprimée', original_name = 'piece-supprimee', purged_at = now()
  WHERE d.uploaded_by_debtor = person AND d.case_id IS NULL AND d.purged_at IS NULL;
  -- The registry keeps the request ten years, without how it came (free text).
  UPDATE public.gdpr_requests g SET origin = 'Demande anonymisée' WHERE g.debtor_id = person;
  UPDATE public.debtors d SET name = 'Débiteur anonymisé', siren = NULL, legal_form_code = NULL, legal_form_source = NULL, legal_form_checked_at = NULL,
    anonymized_at = now()
  WHERE d.id = person;
  RETURN true;
END
$$;
GRANT EXECUTE ON FUNCTION app.forget_case(uuid), app.forget_debtor(uuid) TO legarec_definer;
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM legarec_forgetter;

-- ---------------------------------------------------------------- An anonymized case is written no more

GRANT CREATE ON SCHEMA app TO legarec_definer;
SET LOCAL ROLE legarec_definer;

CREATE FUNCTION app.case_writable(target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT NOT EXISTS (SELECT 1 FROM public.cases c WHERE c.id = target AND c.anonymized_at IS NOT NULL)
$$;

-- As before, and refused (409) on an anonymized case: payments, plans and requests of the RGPD go through it.
CREATE OR REPLACE FUNCTION app.money_case(target uuid, OUT creditor_id uuid, OUT debtor_id uuid, OUT officer_id uuid, OUT mandate_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'STAFF' OR app.staff_role() IS NULL OR app.staff_role() = 'DEVELOPER' THEN
    PERFORM app.refuse('42501');
  END IF;
  SELECT c.creditor_id, c.debtor_id, c.officer_id, c.mandate_id INTO creditor_id, debtor_id, officer_id, mandate_id
  FROM public.cases c WHERE c.id = target AND app.can_act_on_case(c.officer_id);
  IF NOT FOUND THEN
    PERFORM app.refuse('42501');
  END IF;
  IF NOT app.case_writable(target) THEN
    PERFORM app.refuse('LG409');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('money:' || target::text, 0));
END
$$;

CREATE OR REPLACE FUNCTION app.add_case_event(target uuid, kind text, title text, detail text, tone event_tone, visible_to_creditor boolean) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  owner public.cases.creditor_id%TYPE;
BEGIN
  SELECT c.creditor_id INTO owner FROM public.cases c
  WHERE c.id = target AND (
    app.can_act_on_case(c.officer_id)
    OR c.creditor_id = app.partner_creditor()
    OR (c.debtor_id = app.debtor_id() AND c.first_letter_on IS NOT NULL)
    OR app.actor_kind() = 'SYSTEM'
  );
  IF owner IS NULL THEN
    RAISE EXCEPTION 'case not found' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT app.case_writable(target) THEN
    PERFORM app.refuse('LG409');
  END IF;
  INSERT INTO public.case_events (case_id, creditor_id, kind, title, detail, tone, actor_kind, actor_id, actor_label, on_behalf_of_id, visible_to_creditor)
  VALUES (target, owner, kind, title, detail, tone, app.actor_kind(), app.actor_id(), app.actor_label(), app.on_behalf_of(), visible_to_creditor);
END
$$;

-- ---------------------------------------------------------------- Retention and erasure

-- Every night, by the retention: the cases closed more than five years ago (question 77). Neither a duration nor a list
-- is passed. A case someone holds waits for the next night; so do those beyond the first thousand.
CREATE FUNCTION app.anonymize_case() RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  today date := (now() AT TIME ZONE 'Europe/Paris')::date;
  held uuid[];
  target uuid;
  person uuid;
BEGIN
  SELECT coalesce(array_agg(old.id), '{}') INTO held FROM (
    SELECT c.id FROM public.cases c
    WHERE c.anonymized_at IS NULL AND c.closed_on IS NOT NULL AND (c.closed_on + interval '5 years')::date < today
    ORDER BY c.id LIMIT 1000 FOR UPDATE SKIP LOCKED) old;
  FOREACH target IN ARRAY held LOOP
    PERFORM app.forget_case(target);
  END LOOP;
  FOR person IN SELECT DISTINCT c.debtor_id FROM public.cases c WHERE c.id = ANY (held) ORDER BY 1 LOOP
    PERFORM app.forget_debtor(person);
  END LOOP;
  RETURN cardinality(held);
END
$$;

-- Why the erasure asked by a debtor cannot be done now (article 17.3 of the RGPD: a claim under way, a legal obligation):
-- one of their cases is open, a payment is not settled yet, or one has not been remitted to its creditor.
CREATE FUNCTION app.erasure_blockers(person uuid) RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT array_remove(ARRAY[
    CASE WHEN EXISTS (SELECT 1 FROM public.cases c WHERE c.debtor_id = person AND c.closed_on IS NULL) THEN 'OPEN_CASE' END,
    CASE WHEN EXISTS (SELECT 1 FROM public.payments p JOIN public.cases c ON c.id = p.case_id
      WHERE c.debtor_id = person AND p.status IN ('RECEIVED', 'DEPOSITED', 'TO_RECONCILE')) THEN 'PAYMENT_PENDING' END,
    CASE WHEN EXISTS (SELECT 1 FROM public.payments p JOIN public.cases c ON c.id = p.case_id
      WHERE c.debtor_id = person AND p.status IN ('CASHED', 'RECONCILED')
        AND NOT EXISTS (SELECT 1 FROM public.remittance_lines l JOIN public.remittances r ON r.id = l.remittance_id WHERE l.payment_id = p.id AND r.state = 'PAID'))
      THEN 'NOT_REMITTED' END
  ], NULL)
$$;

-- The cases an erasure would anonymize, as a fingerprint of their identifiers: what is confirmed is what was shown.
CREATE FUNCTION app.erasure_digest(person uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT encode(sha256(convert_to(coalesce(string_agg(c.id::text, ',' ORDER BY c.id), ''), 'UTF8')), 'hex')
  FROM public.cases c WHERE c.debtor_id = person AND c.anonymized_at IS NULL
$$;

-- What an erasure would do, what stands in its way, and how many other individuals carry the same name: two
-- individuals are never put together (app.open_debtor), the same person may have a line per creditor. Only a number.
CREATE FUNCTION app.gdpr_erasure(target uuid, OUT cases integer, OUT digest text, OUT blockers text[], OUT homonyms integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  asked record;
BEGIN
  PERFORM app.gdpr_keeper();
  SELECT g.debtor_id, g.status, d.kind, d.name INTO asked FROM public.gdpr_requests g JOIN public.debtors d ON d.id = g.debtor_id
  WHERE g.id = target AND g.kind = 'ERASURE';
  IF NOT FOUND THEN
    PERFORM app.refuse('LG404');
  END IF;
  SELECT count(*)::integer INTO cases FROM public.cases c WHERE c.debtor_id = asked.debtor_id AND c.anonymized_at IS NULL;
  digest := app.erasure_digest(asked.debtor_id);
  blockers := app.erasure_blockers(asked.debtor_id);
  IF asked.status <> 'OPEN' THEN
    blockers := array_append(blockers, 'REQUEST_CLOSED');
  END IF;
  SELECT count(*)::integer INTO homonyms FROM public.debtors d
  WHERE asked.kind = 'INDIVIDUAL' AND d.kind = 'INDIVIDUAL' AND d.id <> asked.debtor_id AND d.anonymized_at IS NULL
    AND app.plain_name(d.name) = app.plain_name(asked.name);
END
$$;

-- The erasure itself, by the Director or their administrative delegate, for the very cases that were shown: refused
-- (409) if anything changed since, or if anything stands in its way. The pieces of accounting stay ten years. Cases are
-- held first, then the debtor, as by the night.
CREATE FUNCTION app.gdpr_erase(target uuid, expected integer, expected_digest text) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  asked record;
  held uuid[];
  one uuid;
BEGIN
  PERFORM app.gdpr_keeper();
  SELECT g.debtor_id, g.status INTO asked FROM public.gdpr_requests g WHERE g.id = target AND g.kind = 'ERASURE' FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app.refuse('LG404');
  END IF;
  SELECT coalesce(array_agg(mine.id), '{}') INTO held FROM (
    SELECT c.id FROM public.cases c WHERE c.debtor_id = asked.debtor_id AND c.anonymized_at IS NULL ORDER BY c.id FOR UPDATE) mine;
  IF asked.status <> 'OPEN' OR cardinality(app.erasure_blockers(asked.debtor_id)) > 0 OR cardinality(held) IS DISTINCT FROM expected
    OR app.erasure_digest(asked.debtor_id) IS DISTINCT FROM expected_digest THEN
    PERFORM app.refuse('LG409');
  END IF;
  FOREACH one IN ARRAY held LOOP
    PERFORM app.forget_case(one);
  END LOOP;
  -- A case opened for them meanwhile: nothing is done.
  IF NOT app.forget_debtor(asked.debtor_id) THEN
    PERFORM app.refuse('LG409');
  END IF;
  UPDATE public.gdpr_requests g SET status = 'ANSWERED', answered_at = now(), answered_by = app.user_id(),
    reason = 'Données anonymisées ; quittances, factures, paiements, reversements et échéanciers signés conservés 10 ans (obligation légale).'
  WHERE g.id = target;
  PERFORM app.log('GDPR_ERASED', 'gdpr_request', target, jsonb_build_object('count', least(cardinality(held), 999)));
  RETURN cardinality(held);
END
$$;

GRANT EXECUTE ON FUNCTION app.anonymize_case() TO legarec_retention;
GRANT EXECUTE ON FUNCTION app.gdpr_erasure(uuid), app.gdpr_erase(uuid, integer, text) TO legarec_staff;
GRANT EXECUTE ON FUNCTION app.case_writable(uuid) TO legarec_staff, legarec_partner, legarec_debtor, legarec_worker;
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM legarec_definer;

-- Whatever the role, nothing is added to an anonymized case nor changed in it; but the notifications, read as before.
DO $$
DECLARE
  target text;
BEGIN
  FOR target IN SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables t USING (table_schema, table_name)
    WHERE c.table_schema = 'public' AND c.column_name = 'case_id' AND t.table_type = 'BASE TABLE' AND c.table_name <> 'notifications' ORDER BY 1 LOOP
    EXECUTE format('CREATE POLICY case_not_forgotten_add ON %I AS RESTRICTIVE FOR INSERT TO legarec_staff, legarec_partner, legarec_debtor, legarec_worker
      WITH CHECK (case_id IS NULL OR app.case_writable(case_id))', target);
    EXECUTE format('CREATE POLICY case_not_forgotten_change ON %I AS RESTRICTIVE FOR UPDATE TO legarec_staff, legarec_partner, legarec_debtor, legarec_worker
      USING (case_id IS NULL OR app.case_writable(case_id))', target);
  END LOOP;
END
$$;
CREATE POLICY case_not_forgotten ON cases AS RESTRICTIVE FOR UPDATE TO legarec_staff, legarec_partner, legarec_debtor, legarec_worker USING (anonymized_at IS NULL);
