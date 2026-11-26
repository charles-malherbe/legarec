-- Retention of the cases (docs/api.md, « Conservation ») and erasure at the request of a debtor (RGPD, article 17).
-- Five years after it closed, a case is anonymized: its history, its exchanges, its coordinates and its attachments go,
-- the files of the attachments are erased from the disk; its line stays, without the address of the debtor, because the
-- receipts, invoices, payments and remittances that refer to it are kept ten years. A debtor shared by several cases is
-- anonymized with the last of them; its line stays, without name nor SIREN. The durations are written in the functions.
--
-- Every table attached to a case is listed in app.forget_case(): a table added later (litigation_files of lot U) is
-- added there too, by a new version of the function, or its rows would hold the case forever.

CREATE TYPE retention_class AS ENUM ('CASE', 'ACCOUNTING');

ALTER TABLE cases
  ADD COLUMN anonymized_at timestamptz(3),
  -- Shown, never used by the purge: app.anonymize_case() writes its own duration.
  ADD COLUMN purge_after date GENERATED ALWAYS AS ((closed_on + interval '5 years')::date) STORED;
CREATE INDEX cases_to_forget ON cases (closed_on) WHERE anonymized_at IS NULL AND closed_on IS NOT NULL;

-- Receipts and statements of remittances are pieces of accounting: ten years, whatever becomes of their case.
ALTER TABLE documents
  ADD COLUMN retention_class retention_class NOT NULL GENERATED ALWAYS AS (CASE WHEN category IN ('RECEIPT', 'REMITTANCE') THEN 'ACCOUNTING'::retention_class ELSE 'CASE'::retention_class END) STORED,
  -- Its file is erased: the line stays for what refers to it (a payment plan), without its names.
  ADD COLUMN purged_at timestamptz(3);
CREATE INDEX documents_purged ON documents (purged_at) WHERE purged_at IS NOT NULL;

-- Nobody but the purge sees an erased document: lists and downloads leave it out by themselves.
CREATE POLICY not_purged ON documents AS RESTRICTIVE FOR SELECT TO legarec_staff, legarec_partner, legarec_debtor, legarec_worker USING (purged_at IS NULL);
-- An anonymized case is never changed again by the team.
CREATE POLICY staff_not_forgotten ON cases AS RESTRICTIVE FOR UPDATE TO legarec_staff USING (anonymized_at IS NULL);

GRANT SELECT (anonymized_at, purge_after) ON cases TO legarec_staff, legarec_worker;
GRANT SELECT (retention_class, purged_at) ON documents TO legarec_staff, legarec_worker;

-- What the functions below need, and only while they forget (app.forgetting, set by them for their transaction).
GRANT SELECT (anonymized_at), UPDATE (debtor_siret, debtor_address, debtor_postal_code, debtor_city, contact_name, contact_title,
  external_reference, deposited_name, anonymized_at) ON cases TO legarec_definer;
GRANT UPDATE (siren, legal_form_code, legal_form_source, legal_form_checked_at, anonymized_at) ON debtors TO legarec_definer;
GRANT DELETE ON case_events TO legarec_definer;
GRANT SELECT (case_id), DELETE ON case_contact_events TO legarec_definer;
GRANT DELETE ON case_contacts TO legarec_definer;
GRANT DELETE ON portal_message_attachments, portal_messages TO legarec_definer;
GRANT DELETE ON planned_reminders TO legarec_definer;
GRANT DELETE ON debtor_links TO legarec_definer;
GRANT SELECT (case_id), DELETE ON ai_suggestions TO legarec_definer;
GRANT DELETE ON debtor_access_codes TO legarec_definer;
GRANT DELETE ON debtor_retired_codes TO legarec_definer;
GRANT SELECT (accepted_ip), UPDATE (accepted_ip) ON payment_plans TO legarec_definer;
GRANT SELECT (case_id, reason) ON plan_approvals TO legarec_definer;
GRANT SELECT (retention_class, purged_at), UPDATE (title, original_name, purged_at, visible_to_debtor) ON documents TO legarec_definer;

DO $$
DECLARE
  target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['cases', 'debtors', 'case_events', 'case_contact_events', 'case_contacts', 'portal_message_attachments', 'portal_messages',
    'planned_reminders', 'debtor_links', 'ai_suggestions', 'debtor_access_codes', 'debtor_retired_codes', 'debtor_sessions', 'payment_plans', 'plan_approvals', 'documents'] LOOP
    EXECUTE format('CREATE POLICY definer_forget ON %I TO legarec_definer USING ((SELECT app.setting(''forgetting'')) = ''on'') WITH CHECK ((SELECT app.setting(''forgetting'')) = ''on'')', target);
  END LOOP;
END
$$;

-- The files of the erased documents, removed from the disk by the purge (again after a restoration).
CREATE POLICY retention_files ON documents FOR SELECT TO legarec_retention USING (purged_at IS NOT NULL);
GRANT SELECT (storage_key, purged_at) ON documents TO legarec_retention;

GRANT CREATE ON SCHEMA app TO legarec_definer;
SET LOCAL ROLE legarec_definer;

-- Everything a case holds about its debtor, but what accounting keeps ten years. Called by the functions below only.
CREATE FUNCTION app.forget_case(target uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF app.setting('forgetting') IS DISTINCT FROM 'on' THEN
    PERFORM app.refuse('42501');
  END IF;
  -- The history and the journal of the coordinates: append-only, but for the retention.
  PERFORM set_config('app.purging', 'case_contact_events', true);
  DELETE FROM public.case_contact_events WHERE case_id = target;
  PERFORM set_config('app.purging', 'case_events', true);
  DELETE FROM public.case_events WHERE case_id = target;
  PERFORM set_config('app.purging', '', true);
  DELETE FROM public.case_contacts WHERE case_id = target;
  DELETE FROM public.portal_message_attachments WHERE case_id = target;
  DELETE FROM public.portal_messages WHERE case_id = target;
  DELETE FROM public.planned_reminders WHERE case_id = target;
  DELETE FROM public.debtor_links WHERE case_id = target;
  DELETE FROM public.ai_suggestions WHERE case_id = target;
  -- The plans stay with the payments they explain; who accepted them, from where, and why the firm decided, go.
  UPDATE public.payment_plans SET accepted_ip = NULL WHERE case_id = target AND accepted_ip IS NOT NULL;
  UPDATE public.plan_approvals SET reason = NULL WHERE case_id = target AND reason IS NOT NULL;
  -- The attachments, but the pieces of accounting (receipts): their files go with the next purge.
  UPDATE public.documents d SET title = 'Pièce supprimée', original_name = 'piece-supprimee', purged_at = now(), visible_to_debtor = false,
    shared_with_creditor_at = NULL, shared_by = NULL
  WHERE d.case_id = target AND d.purged_at IS NULL AND d.retention_class = 'CASE'
    AND NOT EXISTS (SELECT 1 FROM public.receipts r WHERE r.document_id = d.id);
  UPDATE public.cases c SET debtor_siret = NULL, debtor_address = NULL, debtor_postal_code = NULL, debtor_city = NULL, contact_name = NULL,
    contact_title = NULL, external_reference = NULL, deposited_name = NULL, anonymized_at = now()
  WHERE c.id = target;
END
$$;

-- A debtor once none of their cases names them any more. Its line stays: the cases refer to it.
CREATE FUNCTION app.forget_debtor(person uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF app.setting('forgetting') IS DISTINCT FROM 'on' THEN
    PERFORM app.refuse('42501');
  END IF;
  PERFORM 1 FROM public.debtors d WHERE d.id = person AND d.anonymized_at IS NULL FOR UPDATE;
  IF NOT FOUND OR EXISTS (SELECT 1 FROM public.cases c WHERE c.debtor_id = person AND c.anonymized_at IS NULL) THEN
    RETURN false;
  END IF;
  DELETE FROM public.debtor_sessions WHERE debtor_id = person;
  DELETE FROM public.debtor_links WHERE debtor_id = person;
  DELETE FROM public.debtor_access_codes WHERE debtor_id = person;
  DELETE FROM public.debtor_retired_codes WHERE debtor_id = person;
  -- Files sent by the debtor and never attached to a case.
  UPDATE public.documents d SET title = 'Pièce supprimée', original_name = 'piece-supprimee', purged_at = now()
  WHERE d.uploaded_by_debtor = person AND d.case_id IS NULL AND d.purged_at IS NULL;
  UPDATE public.debtors d SET name = 'Débiteur anonymisé', siren = NULL, legal_form_code = NULL, legal_form_source = NULL, legal_form_checked_at = NULL,
    anonymized_at = now()
  WHERE d.id = person;
  RETURN true;
END
$$;

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
  PERFORM set_config('app.forgetting', 'on', true);
  SELECT coalesce(array_agg(old.id), '{}') INTO held FROM (
    SELECT c.id FROM public.cases c
    WHERE c.anonymized_at IS NULL AND c.closed_on IS NOT NULL AND (c.closed_on + interval '5 years')::date < today
    ORDER BY c.closed_on, c.id LIMIT 1000 FOR UPDATE SKIP LOCKED) old;
  FOREACH target IN ARRAY held LOOP
    PERFORM app.forget_case(target);
  END LOOP;
  FOR person IN SELECT DISTINCT c.debtor_id FROM public.cases c WHERE c.id = ANY (held) LOOP
    PERFORM app.forget_debtor(person);
  END LOOP;
  PERFORM set_config('app.forgetting', '', true);
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

-- What an erasure would do: the cases it would anonymize, and what stands in its way.
CREATE FUNCTION app.gdpr_erasure(target uuid, OUT cases integer, OUT blockers text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  asked record;
BEGIN
  PERFORM app.gdpr_keeper();
  SELECT g.debtor_id, g.status INTO asked FROM public.gdpr_requests g WHERE g.id = target AND g.kind = 'ERASURE';
  IF NOT FOUND THEN
    PERFORM app.refuse('LG404');
  END IF;
  SELECT count(*)::integer INTO cases FROM public.cases c WHERE c.debtor_id = asked.debtor_id AND c.anonymized_at IS NULL;
  blockers := app.erasure_blockers(asked.debtor_id);
  IF asked.status <> 'OPEN' THEN
    blockers := array_append(blockers, 'REQUEST_CLOSED');
  END IF;
END
$$;

-- The erasure itself, by the Director or their administrative delegate, for as many cases as were shown: refused (409)
-- if anything changed since, or if anything stands in its way. The pieces of accounting stay ten years.
CREATE FUNCTION app.gdpr_erase(target uuid, expected integer) RETURNS integer
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
  PERFORM set_config('app.forgetting', 'on', true);
  -- Held, so that no case of theirs is opened, paid or changed meanwhile.
  PERFORM 1 FROM public.debtors d WHERE d.id = asked.debtor_id FOR UPDATE;
  SELECT coalesce(array_agg(mine.id), '{}') INTO held FROM (
    SELECT c.id FROM public.cases c WHERE c.debtor_id = asked.debtor_id AND c.anonymized_at IS NULL ORDER BY c.id FOR UPDATE) mine;
  IF asked.status <> 'OPEN' OR cardinality(app.erasure_blockers(asked.debtor_id)) > 0 OR cardinality(held) IS DISTINCT FROM expected THEN
    PERFORM app.refuse('LG409');
  END IF;
  FOREACH one IN ARRAY held LOOP
    PERFORM app.forget_case(one);
  END LOOP;
  PERFORM app.forget_debtor(asked.debtor_id);
  PERFORM set_config('app.forgetting', '', true);
  UPDATE public.gdpr_requests g SET status = 'ANSWERED', answered_at = now(), answered_by = app.user_id(),
    reason = 'Données anonymisées ; quittances, factures, paiements et reversements conservés 10 ans (obligation légale).'
  WHERE g.id = target;
  PERFORM app.log('GDPR_ERASED', 'gdpr_request', target, jsonb_build_object('count', least(cardinality(held), 999)));
  RETURN cardinality(held);
END
$$;

GRANT EXECUTE ON FUNCTION app.anonymize_case() TO legarec_retention;
GRANT EXECUTE ON FUNCTION app.gdpr_erasure(uuid), app.gdpr_erase(uuid, integer) TO legarec_staff;
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM legarec_definer;
