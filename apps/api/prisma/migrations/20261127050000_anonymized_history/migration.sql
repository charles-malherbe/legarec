-- The history of an anonymized case stays, without names (question 169, 26/11/2026): its kinds, titles, dates and who of the
-- team acted (question 132); its free text goes, and a title that would name the debtor or the person to reach is replaced.
-- Coordinates, messages, planned reminders, attachments and the follow-up of litigation still go (question 181).
-- A new version of app.forget_case(), still owned by legarec_forgetter; the history stays append-only but for this.
-- Then (questions 192 and 193, 27/11/2026): a line of that history goes with the pieces of accounting, ten years after the end
-- of its year; at an erasure asked by the debtor, only the lines of the payments and the plans stay.

GRANT SELECT (title, occurred_at, kind), UPDATE (title, detail) ON case_events TO legarec_forgetter;
-- Granted by its owner, the definer.
SET LOCAL ROLE legarec_definer;
GRANT EXECUTE ON FUNCTION app.plain_name(text) TO legarec_forgetter;
RESET ROLE;
GRANT SELECT (name) ON debtors TO legarec_forgetter;
GRANT SELECT (deposited_name, contact_name) ON cases TO legarec_forgetter;
-- The portal shows « Débiteur anonymisé » for an anonymized case, though its debtor still has an open one elsewhere.
GRANT SELECT (anonymized_at) ON cases TO legarec_partner;

-- Append-only, but the forgetter may empty what was typed in the history of a case it anonymizes, and nothing else.
CREATE OR REPLACE FUNCTION app.refuse_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- The forgetter may call nothing: its own case first.
    IF current_user = 'legarec_forgetter' THEN
      IF TG_TABLE_NAME IN ('case_events', 'case_contact_events', 'payment_allocations', 'receipts', 'remittance_lines', 'billing_documents', 'billing_lines') THEN
        RETURN OLD;
      END IF;
    -- app.purge_audit() alone: a setting never opens any other table, not even to a function of the definer.
    ELSIF current_user = 'legarec_definer' AND TG_TABLE_NAME = 'audit_log' AND app.setting('purging') = 'audit_log' THEN
      RETURN OLD;
    END IF;
  -- The forgetter empties what was typed in the history of a case it anonymizes (question 169), and changes nothing else.
  ELSIF TG_OP = 'UPDATE' AND current_user = 'legarec_forgetter' AND TG_TABLE_NAME = 'case_events'
    AND (to_jsonb(NEW) - 'title' - 'detail') = (to_jsonb(OLD) - 'title' - 'detail') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'append-only table: %', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END
$$;

GRANT CREATE ON SCHEMA app TO legarec_forgetter;
SET LOCAL ROLE legarec_forgetter;

-- Everything a case holds about its debtor, but what accounting keeps ten years, and its history without names.
CREATE OR REPLACE FUNCTION app.forget_case(target uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  debtor_name text;
  given_name text;
  contact text;
BEGIN
  DELETE FROM public.case_contact_events WHERE case_id = target;
  -- The history stays without names (question 169): what was typed goes, a title that names the debtor or the person to
  -- reach is replaced, who of the team acted stays (question 132).
  SELECT nullif(btrim(d.name), ''), nullif(btrim(c.deposited_name), ''), nullif(btrim(c.contact_name), '') INTO debtor_name, given_name, contact
  FROM public.cases c JOIN public.debtors d ON d.id = c.debtor_id WHERE c.id = target;
  -- Names compared without accents, signs nor legal forms (« SARL Dupont » finds « Dupont »).
  UPDATE public.case_events e SET detail = NULL,
    title = CASE WHEN EXISTS (SELECT 1 FROM unnest(ARRAY[debtor_name, given_name, contact]) AS n(value)
        WHERE length(app.plain_name(n.value)) >= 3 AND strpos(app.plain_name(e.title), app.plain_name(n.value)) > 0) THEN 'Événement du dossier' ELSE e.title END
  WHERE e.case_id = target;
  DELETE FROM public.case_contacts WHERE case_id = target;
  DELETE FROM public.portal_message_attachments WHERE case_id = target;
  DELETE FROM public.portal_messages WHERE case_id = target;
  DELETE FROM public.planned_reminders WHERE case_id = target;
  DELETE FROM public.debtor_links WHERE case_id = target;
  DELETE FROM public.ai_suggestions WHERE case_id = target;
  DELETE FROM public.litigation_files WHERE case_id = target;
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
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM legarec_forgetter;

-- ---------------------------------------------------------------- Questions 192 and 193

GRANT CREATE ON SCHEMA app TO legarec_forgetter;
SET LOCAL ROLE legarec_forgetter;
-- At an erasure asked by the debtor (question 193): of the history of the case, the lines of the payments, of the plans and
-- of the request stay with the pieces of accounting; the others, which tell what the debtor did or said, go.
CREATE FUNCTION app.forget_case_story(target uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  DELETE FROM public.case_events e WHERE e.case_id = target
    AND NOT (e.kind LIKE 'PAYMENT\_%' OR e.kind LIKE 'PLAN\_%' OR e.kind IN ('CASE_SETTLED', 'GDPR_REQUEST'));
END
$$;
-- Every night (question 192): a line of the history of an anonymized case goes as the pieces of accounting do, ten years
-- after the end of its year (app.accounting_cutoff()); a thousand at most each night.
CREATE FUNCTION app.forget_old_history() RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  removed integer;
BEGIN
  DELETE FROM public.case_events e WHERE e.id IN (
    SELECT o.id FROM public.case_events o JOIN public.cases c ON c.id = o.case_id
    WHERE c.anonymized_at IS NOT NULL AND (o.occurred_at AT TIME ZONE 'Europe/Paris')::date < app.accounting_cutoff()
    ORDER BY o.id LIMIT 1000);
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END
$$;
REVOKE ALL ON FUNCTION app.forget_case_story(uuid), app.forget_old_history() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.forget_case_story(uuid), app.forget_old_history() TO legarec_definer;
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM legarec_forgetter;
GRANT SELECT (id) ON case_events TO legarec_forgetter;

GRANT CREATE ON SCHEMA app TO legarec_definer;
SET LOCAL ROLE legarec_definer;
CREATE FUNCTION app.purge_old_history() RETURNS integer
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT app.forget_old_history()
$$;
REVOKE ALL ON FUNCTION app.purge_old_history() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.purge_old_history() TO legarec_retention;
-- The erasure asked by the debtor, as before (20261126180000_case_retention), with the history reduced (question 193) and an
-- answer that says what stays.
CREATE OR REPLACE FUNCTION app.gdpr_erase(target uuid, expected integer, expected_digest text) RETURNS integer
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
    -- Asked by the debtor: only the history of the payments and the plans stays (question 193).
    PERFORM app.forget_case_story(one);
  END LOOP;
  -- A case opened for them meanwhile: nothing is done.
  IF NOT app.forget_debtor(asked.debtor_id) THEN
    PERFORM app.refuse('LG409');
  END IF;
  UPDATE public.gdpr_requests g SET status = 'ANSWERED', answered_at = now(), answered_by = app.user_id(),
    reason = 'Données anonymisées ; quittances, factures, paiements, reversements et échéanciers signés conservés 10 ans (obligation légale), avec la seule trace de ces paiements et échéanciers dans l’historique des dossiers, sans nom.'
  WHERE g.id = target;
  PERFORM app.log('GDPR_ERASED', 'gdpr_request', target, jsonb_build_object('count', least(cardinality(held), 999)));
  RETURN cardinality(held);
END
$$;
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM legarec_definer;
