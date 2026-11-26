-- The history of an anonymized case stays, without names (question 169, 26/11/2026): its kinds, titles, dates and who of the
-- team acted (question 132); its free text goes, and a title that would name the debtor or the person to reach is replaced.
-- Coordinates, messages, planned reminders, attachments and the follow-up of litigation still go (question 181).
-- A new version of app.forget_case(), still owned by legarec_forgetter; the history stays append-only but for this.

GRANT SELECT (title, detail), UPDATE (title, detail) ON case_events TO legarec_forgetter;
GRANT SELECT (name) ON debtors TO legarec_forgetter;
GRANT SELECT (deposited_name, contact_name) ON cases TO legarec_forgetter;

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
  UPDATE public.case_events e SET detail = NULL,
    title = CASE WHEN EXISTS (SELECT 1 FROM unnest(ARRAY[debtor_name, given_name, contact]) AS n(value)
        WHERE length(n.value) >= 3 AND strpos(lower(e.title), lower(n.value)) > 0) THEN 'Événement du dossier' ELSE e.title END
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
