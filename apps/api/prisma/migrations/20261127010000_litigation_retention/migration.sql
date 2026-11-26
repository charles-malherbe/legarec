-- Litigation follows the retention of its case (lot V): five years after the case closed, or at the request of the
-- debtor, the follow-up goes with the history. The court and the partner are free text, which may name people; the
-- steps of the procedure are lines of the history, already erased. The status of the case (settled or lost) stays.
-- A new version of app.forget_case(), still owned by legarec_forgetter, with its rights on the table.

CREATE POLICY forgetter_all ON litigation_files TO legarec_forgetter USING (true) WITH CHECK (true);
GRANT SELECT (case_id), DELETE ON litigation_files TO legarec_forgetter;

GRANT CREATE ON SCHEMA app TO legarec_forgetter;
SET LOCAL ROLE legarec_forgetter;

-- Everything a case holds about its debtor, but what accounting keeps ten years.
CREATE OR REPLACE FUNCTION app.forget_case(target uuid) RETURNS void
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
