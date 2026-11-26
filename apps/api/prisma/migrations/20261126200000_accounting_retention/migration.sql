-- Retention of the pieces of accounting (docs/api.md, « Conservation » ; question V-10): invoices of the firm, credit
-- notes, payments and their allocations, receipts, remittances, and the registry of the RGPD are kept ten years. Article
-- L123-22 of the Code de commerce counts them from the close of the financial year: the most prudent reading is kept, the
-- end of the calendar year of the piece. A piece of year Y is kept until 31 December of Y + 10 and goes from 1 January of
-- Y + 11. The duration is written in the functions, never passed.
--
-- What refers to each other goes together, so that no foreign key is broken and no statement half remains:
--   * a batch of remittances marked as paid, with its remittances and their lines, the invoices of the commission they
--     issued, the credit notes of these invoices (and their refunds, their drafts), and the payments of their lines (with
--     their allocations, their receipts and the files of these): once the most recent of all of them is old enough, all the
--     cases of the lines are anonymized, and none of these cases still has a payment to remit, that is cashed and not in a
--     remittance paid (else the creditor would never be paid it, or its opening fee would be taken again). A batch never
--     marked as paid stays, whatever its age;
--     Batches tied by a credit note given back by a later remittance go together, or wait together;
--   * an invoice that no remittance issued, with its credit notes, when the most recent of them is old enough;
--   * a bounced payment, never remitted, of an anonymized case;
--   * the files kept for accounting of an anonymized case (signed payment plans, statements), once old enough. A file of
--     accounting without a case (a statement of remittances) is tied to nothing that says whether its batch stays: kept.
-- An invoice with a draft of credit note changed in the last 30 days stays (the draft goes on its own after 30 days).
-- A payment cashed and never remitted, or still pending, stays: it is money the creditor is owed (question V-10). The case
-- and its debtor keep their lines. Numbers are drawn from number_sequences, which nothing here touches: none is used again.
--
-- What is erased is erased by the forgetter (20261126180000_case_retention), through the functions of the definer that the
-- retention alone may call, at most a thousand of each a night.

GRANT SELECT (id, status, validated_at, paid_on), DELETE ON remittance_batches TO legarec_forgetter;
GRANT SELECT (id, batch_id, invoice_id, state), DELETE ON remittances TO legarec_forgetter;
GRANT SELECT (remittance_id, case_id, payment_id), DELETE ON remittance_lines TO legarec_forgetter;
GRANT SELECT (id, kind, corrected_id, issued_on), DELETE ON billing_documents TO legarec_forgetter;
GRANT SELECT (document_id), DELETE ON billing_lines TO legarec_forgetter;
GRANT SELECT (credit_note_id, remittance_id), DELETE ON credit_note_refunds TO legarec_forgetter;
GRANT SELECT (invoice_id, updated_at), DELETE ON credit_note_drafts TO legarec_forgetter;
GRANT SELECT (payment_id), DELETE ON payment_allocations TO legarec_forgetter;
GRANT SELECT (id, status, received_on, deposited_on, settled_at, bounced_at), DELETE ON payments TO legarec_forgetter;
GRANT SELECT (payment_id, issued_at), DELETE ON receipts TO legarec_forgetter;
GRANT SELECT (created_at) ON documents TO legarec_forgetter;
DO $$
DECLARE
  target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['remittance_batches', 'remittances', 'remittance_lines', 'billing_documents', 'billing_lines', 'credit_note_refunds',
    'credit_note_drafts', 'payment_allocations'] LOOP
    EXECUTE format('CREATE POLICY forgetter_all ON %I TO legarec_forgetter USING (true) WITH CHECK (true)', target);
  END LOOP;
END
$$;

-- The tables written once stay so, but for the forgetter.
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
  END IF;
  RAISE EXCEPTION 'append-only table: %', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END
$$;
-- A receipt never changes but for its PDF (app.keep_receipt), and is removed by the forgetter alone.
DROP TRIGGER keep_receipt ON receipts;
CREATE TRIGGER keep_receipt BEFORE UPDATE ON receipts FOR EACH ROW EXECUTE FUNCTION app.keep_receipt();
CREATE TRIGGER refuse_change BEFORE DELETE ON receipts FOR EACH ROW EXECUTE FUNCTION app.refuse_change();

-- The registry of the RGPD: ten years from the close of the request, counted as the accounting (it was from its receipt).
GRANT SELECT (answered_at) ON gdpr_requests TO legarec_retention;
DROP POLICY retention_purge ON gdpr_requests;
CREATE POLICY retention_purge ON gdpr_requests FOR DELETE TO legarec_retention USING (
  answered_at IS NOT NULL AND (answered_at AT TIME ZONE 'Europe/Paris')::date < make_date(extract(year FROM now() AT TIME ZONE 'Europe/Paris')::integer - 10, 1, 1));

-- ---------------------------------------------------------------- The forgetter

GRANT CREATE ON SCHEMA app TO legarec_forgetter;
SET LOCAL ROLE legarec_forgetter;
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- The first day a piece dated before it may go: 1 January, ten years ago. Paris.
CREATE FUNCTION app.accounting_cutoff() RETURNS date
LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT make_date(extract(year FROM now() AT TIME ZONE 'Europe/Paris')::integer - 10, 1, 1)
$$;

-- Payments with all that refers to them: allocations, receipts, and the files of the receipts (erased by the next step of
-- the files). Called by the functions below only, for payments they hold.
CREATE FUNCTION app.forget_payments(targets uuid[]) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  files uuid[];
BEGIN
  SELECT coalesce(array_agg(r.document_id), '{}') INTO files FROM public.receipts r WHERE r.payment_id = ANY (targets) AND r.document_id IS NOT NULL;
  DELETE FROM public.payment_allocations a WHERE a.payment_id = ANY (targets);
  DELETE FROM public.receipts r WHERE r.payment_id = ANY (targets);
  DELETE FROM public.payments p WHERE p.id = ANY (targets);
  UPDATE public.documents d SET title = 'Pièce supprimée', original_name = 'piece-supprimee', purged_at = now(), visible_to_debtor = false,
    shared_with_creditor_at = NULL, shared_by = NULL
  WHERE d.id = ANY (files) AND d.purged_at IS NULL;
END
$$;

-- Invoices of the firm with their credit notes, the lines of both, the drafts and the refunds of these credit notes.
CREATE FUNCTION app.forget_invoices(targets uuid[]) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  family uuid[];
BEGIN
  SELECT targets || coalesce(array_agg(c.id), '{}') INTO family FROM public.billing_documents c WHERE c.corrected_id = ANY (targets);
  DELETE FROM public.credit_note_drafts f WHERE f.invoice_id = ANY (targets);
  DELETE FROM public.credit_note_refunds f WHERE f.credit_note_id = ANY (family);
  -- The lines of a credit note cite those of its invoice: gone in the same statement.
  DELETE FROM public.billing_lines l WHERE l.document_id = ANY (family);
  DELETE FROM public.billing_documents d WHERE d.id = ANY (family);
END
$$;

-- Each invoice of the firm and the batches that touch it: the one whose remittance issued it, those whose remittance gave
-- back one of its credit notes.
CREATE FUNCTION app.invoice_batches() RETURNS TABLE (invoice_id uuid, batch_id uuid)
LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT r.invoice_id, r.batch_id FROM public.remittances r WHERE r.invoice_id IS NOT NULL
  UNION
  SELECT c.corrected_id, r.batch_id FROM public.credit_note_refunds f JOIN public.billing_documents c ON c.id = f.credit_note_id
  JOIN public.remittances r ON r.id = f.remittance_id
$$;

-- Batches of remittances, and everything they hold (see above). Returns the number of batches.
CREATE FUNCTION app.forget_remittances() RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  cutoff date := app.accounting_cutoff();
  pool uuid[];
  kept uuid[];
  gone uuid[];
  invoices uuid[];
  paid uuid[];
  touched_invoice uuid[];
  touched_batch uuid[];
BEGIN
  -- After a validation, a credit note or a draft under way, before the next one. Only a batch marked as paid is taken, and
  -- nothing writes such a batch any more.
  PERFORM pg_advisory_xact_lock(hashtextextended('remittances', 0));
  -- Which invoice touches which batch, read once.
  SELECT coalesce(array_agg(t.invoice_id), '{}'), coalesce(array_agg(t.batch_id), '{}') INTO touched_invoice, touched_batch FROM app.invoice_batches() t;
  SELECT coalesce(array_agg(old.id), '{}') INTO pool FROM (
    SELECT b.id FROM public.remittance_batches b
    WHERE b.status = 'PAID' AND b.paid_on < cutoff AND (b.validated_at AT TIME ZONE 'Europe/Paris')::date < cutoff
      -- Every case of its lines anonymized, none with a payment still to remit: cashed, and in no remittance paid.
      AND NOT EXISTS (
        SELECT 1 FROM public.remittances r JOIN public.remittance_lines l ON l.remittance_id = r.id JOIN public.cases c ON c.id = l.case_id
        WHERE r.batch_id = b.id AND (c.anonymized_at IS NULL OR EXISTS (
          SELECT 1 FROM public.payments p WHERE p.case_id = c.id AND p.status IN ('CASHED', 'RECONCILED')
            AND NOT EXISTS (SELECT 1 FROM public.remittance_lines x JOIN public.remittances y ON y.id = x.remittance_id WHERE x.payment_id = p.id AND y.state = 'PAID'))))
      -- Its payments, and their receipts, as old.
      AND NOT EXISTS (
        SELECT 1 FROM public.remittances r JOIN public.remittance_lines l ON l.remittance_id = r.id JOIN public.payments p ON p.id = l.payment_id
          LEFT JOIN public.receipts q ON q.payment_id = p.id
        WHERE r.batch_id = b.id AND greatest(p.received_on, p.deposited_on, (p.settled_at AT TIME ZONE 'Europe/Paris')::date,
          (p.bounced_at AT TIME ZONE 'Europe/Paris')::date, (q.issued_at AT TIME ZONE 'Europe/Paris')::date) >= cutoff)
      -- The invoices it touches and their credit notes as old; none of these waiting to be given back, nor being corrected.
      AND NOT EXISTS (
        SELECT 1 FROM unnest(touched_invoice, touched_batch) t (invoice_id, batch_id)
          JOIN public.billing_documents d ON d.id = t.invoice_id OR d.corrected_id = t.invoice_id
          LEFT JOIN public.credit_note_refunds f ON f.credit_note_id = d.id
        WHERE t.batch_id = b.id AND (d.issued_on >= cutoff OR (f.credit_note_id IS NOT NULL AND f.remittance_id IS NULL)
          OR EXISTS (SELECT 1 FROM public.credit_note_drafts w WHERE w.invoice_id = t.invoice_id AND w.updated_at >= now() - interval '30 days')))
    ORDER BY b.validated_at, b.id LIMIT 1000) old;
  -- A batch tied to one that stays, stays too.
  LOOP
    SELECT coalesce(array_agg(x), '{}') INTO kept FROM unnest(pool) x
    WHERE NOT EXISTS (
      SELECT 1 FROM unnest(touched_invoice, touched_batch) mine (invoice_id, batch_id)
        JOIN unnest(touched_invoice, touched_batch) other (invoice_id, batch_id) ON other.invoice_id = mine.invoice_id
      WHERE mine.batch_id = x AND NOT other.batch_id = ANY (pool));
    EXIT WHEN cardinality(kept) = cardinality(pool);
    pool := kept;
  END LOOP;
  IF cardinality(pool) = 0 THEN
    RETURN 0;
  END IF;
  SELECT coalesce(array_agg(r.id), '{}') INTO gone FROM public.remittances r WHERE r.batch_id = ANY (pool);
  SELECT coalesce(array_agg(DISTINCT t.invoice_id), '{}') INTO invoices FROM unnest(touched_invoice, touched_batch) t (invoice_id, batch_id)
  WHERE t.batch_id = ANY (pool);
  SELECT coalesce(array_agg(l.payment_id), '{}') INTO paid FROM public.remittance_lines l WHERE l.remittance_id = ANY (gone) AND l.payment_id IS NOT NULL;
  -- Leaves first: refunds and lines, then remittances, then the invoices they cite, then the batches; the payments last.
  DELETE FROM public.credit_note_refunds f WHERE f.remittance_id = ANY (gone);
  DELETE FROM public.remittance_lines l WHERE l.remittance_id = ANY (gone);
  DELETE FROM public.remittances r WHERE r.id = ANY (gone);
  PERFORM app.forget_invoices(invoices);
  DELETE FROM public.remittance_batches b WHERE b.id = ANY (pool);
  PERFORM app.forget_payments(paid);
  RETURN cardinality(pool);
END
$$;

-- Invoices that no remittance issued nor gave back, with their credit notes. Returns the number of invoices.
CREATE FUNCTION app.forget_lone_invoices() RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  cutoff date := app.accounting_cutoff();
  held uuid[];
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('remittances', 0));
  SELECT coalesce(array_agg(old.id), '{}') INTO held FROM (
    SELECT i.id FROM public.billing_documents i
    WHERE i.kind = 'INVOICE' AND i.issued_on < cutoff
      AND NOT EXISTS (SELECT 1 FROM public.remittances r WHERE r.invoice_id = i.id)
      AND NOT EXISTS (SELECT 1 FROM public.billing_documents c WHERE c.corrected_id = i.id AND (c.issued_on >= cutoff
        OR EXISTS (SELECT 1 FROM public.credit_note_refunds f WHERE f.credit_note_id = c.id)))
      AND NOT EXISTS (SELECT 1 FROM public.credit_note_drafts f WHERE f.invoice_id = i.id AND f.updated_at >= now() - interval '30 days')
    ORDER BY i.issued_on, i.id LIMIT 1000) old;
  PERFORM app.forget_invoices(held);
  RETURN cardinality(held);
END
$$;

-- Bounced payments never remitted, of anonymized cases. Returns the number of payments.
CREATE FUNCTION app.forget_bounced_payments() RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  cutoff date := app.accounting_cutoff();
  held uuid[];
BEGIN
  SELECT coalesce(array_agg(old.id), '{}') INTO held FROM (
    SELECT p.id FROM public.payments p JOIN public.cases c ON c.id = p.case_id
    WHERE p.status = 'BOUNCED' AND c.anonymized_at IS NOT NULL
      AND greatest(p.received_on, p.deposited_on, (p.settled_at AT TIME ZONE 'Europe/Paris')::date, (p.bounced_at AT TIME ZONE 'Europe/Paris')::date) < cutoff
      AND NOT EXISTS (SELECT 1 FROM public.remittance_lines l WHERE l.payment_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM public.receipts q WHERE q.payment_id = p.id AND (q.issued_at AT TIME ZONE 'Europe/Paris')::date >= cutoff)
    ORDER BY p.received_on, p.id LIMIT 1000 FOR UPDATE OF p SKIP LOCKED) old;
  PERFORM app.forget_payments(held);
  RETURN cardinality(held);
END
$$;

-- What an anonymized case still kept for accounting (signed payment plans, statements), once old enough; the file of a
-- receipt still kept stays, and so does a file without a case. Returns the number of documents.
CREATE FUNCTION app.forget_accounting_documents() RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  cutoff date := app.accounting_cutoff();
  held uuid[];
BEGIN
  SELECT coalesce(array_agg(old.id), '{}') INTO held FROM (
    SELECT d.id FROM public.documents d JOIN public.cases c ON c.id = d.case_id
    WHERE d.purged_at IS NULL AND (d.created_at AT TIME ZONE 'Europe/Paris')::date < cutoff
      AND c.anonymized_at IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.receipts r WHERE r.document_id = d.id)
    ORDER BY d.id LIMIT 1000 FOR UPDATE OF d SKIP LOCKED) old;
  UPDATE public.documents d SET title = 'Pièce supprimée', original_name = 'piece-supprimee', purged_at = now(), visible_to_debtor = false,
    shared_with_creditor_at = NULL, shared_by = NULL
  WHERE d.id = ANY (held);
  RETURN cardinality(held);
END
$$;
GRANT EXECUTE ON FUNCTION app.forget_remittances(), app.forget_lone_invoices(), app.forget_bounced_payments(), app.forget_accounting_documents() TO legarec_definer;
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM legarec_forgetter;

-- ---------------------------------------------------------------- What the retention calls, every night

GRANT CREATE ON SCHEMA app TO legarec_definer;
SET LOCAL ROLE legarec_definer;

-- As before (20261126190000_credit_notes), under the lock of the remittances: a draft is never saved on an invoice that the
-- purge is removing.
CREATE OR REPLACE FUNCTION app.save_credit_note_draft(draft uuid, invoice uuid, wanted_scope credit_note_scope, lines jsonb, reason text, follow credit_note_follow_up)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  saved uuid;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'STAFF' OR NOT app.acts_as_director('ADMINISTRATIVE') THEN
    PERFORM app.refuse('42501');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('remittances', 0));
  IF app.invoice_left(invoice) IS NULL THEN
    PERFORM app.refuse('LG404');
  END IF;
  IF reason IS NULL OR length(reason) > 1000 THEN
    PERFORM app.refuse('22023');
  END IF;
  PERFORM app.check_credit_lines(invoice, lines);
  IF draft IS NULL THEN
    INSERT INTO public.credit_note_drafts (invoice_id, scope, lines, reason, follow_up, created_by, on_behalf_of_id)
    VALUES (invoice, wanted_scope, lines, btrim(reason), follow, app.user_id(), app.on_behalf_of()) RETURNING id INTO saved;
    PERFORM app.log('CREDIT_NOTE_DRAFT_SAVED', 'credit_note_draft', saved, '{}'::jsonb);
  ELSE
    UPDATE public.credit_note_drafts d SET scope = wanted_scope, lines = save_credit_note_draft.lines, reason = btrim(save_credit_note_draft.reason),
      follow_up = follow, updated_at = now()
    WHERE d.id = draft AND d.invoice_id = invoice RETURNING d.id INTO saved;
    IF saved IS NULL THEN
      PERFORM app.refuse('LG404');
    END IF;
  END IF;
  RETURN saved;
END
$$;
CREATE FUNCTION app.purge_remittances() RETURNS integer
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT app.forget_remittances()
$$;
CREATE FUNCTION app.purge_invoices() RETURNS integer
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT app.forget_lone_invoices()
$$;
CREATE FUNCTION app.purge_payments() RETURNS integer
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT app.forget_bounced_payments()
$$;
CREATE FUNCTION app.purge_accounting_documents() RETURNS integer
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT app.forget_accounting_documents()
$$;
GRANT EXECUTE ON FUNCTION app.purge_remittances(), app.purge_invoices(), app.purge_payments(), app.purge_accounting_documents() TO legarec_retention;
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM legarec_definer;
