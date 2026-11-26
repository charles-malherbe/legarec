-- What the screen « Facturation » reads of the invoices of the firm: the invoices issued (those of the commission, made at the
-- validation of a remittance), with what the credit notes left of each, the day a remittance settled it, the number the next
-- invoice would take (provisional: drawn at the issuance only) and the totals of the year and of the month. Read only: no
-- table, no column, nothing the previous version of the code would miss.

GRANT CREATE ON SCHEMA app TO legarec_definer;
SET LOCAL ROLE legarec_definer;

CREATE FUNCTION app.billing_overview() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  today date := (now() AT TIME ZONE 'Europe/Paris')::date;
  this_year integer := extract(year FROM (now() AT TIME ZONE 'Europe/Paris'));
  year_start date := date_trunc('year', (now() AT TIME ZONE 'Europe/Paris'))::date;
  month_start date := date_trunc('month', (now() AT TIME ZONE 'Europe/Paris'))::date;
BEGIN
  -- As all of the billing: the Director, or whoever acts for them by the administrative delegation.
  IF app.actor_kind() IS DISTINCT FROM 'STAFF' OR NOT app.acts_as_director('ADMINISTRATIVE') THEN
    PERFORM app.refuse('42501');
  END IF;
  RETURN jsonb_build_object(
    'invoices', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', d.id, 'number', d.number, 'issuedOn', d.issued_on, 'creditorId', d.creditor_id, 'gross', d.gross_cents,
          'left', app.invoice_left(d.id), 'settledOn', app.invoice_settled_on(d.id),
          'credited', (SELECT count(*) FROM public.billing_documents c WHERE c.corrected_id = d.id),
          'labels', (SELECT coalesce(jsonb_agg(l.label ORDER BY l.net_cents DESC, l.label), '[]') FROM public.billing_lines l WHERE l.document_id = d.id))
        ORDER BY d.issued_on DESC, d.number DESC)
      FROM (SELECT * FROM public.billing_documents i WHERE i.kind = 'INVOICE' ORDER BY i.issued_on DESC, i.number DESC LIMIT 500) d), '[]'),
    'nextInvoice', 'FA-' || this_year || '-' || lpad((coalesce((SELECT s.last_value FROM public.number_sequences s WHERE s.kind = 'INVOICE' AND s.year = this_year), 0) + 1)::text, 4, '0'),
    -- Invoiced, before VAT, credit notes of the same period taken off.
    'yearNet', (SELECT coalesce(sum(CASE WHEN d.kind = 'INVOICE' THEN d.net_cents ELSE -d.net_cents END), 0)::bigint FROM public.billing_documents d
      WHERE d.issued_on >= year_start AND d.issued_on <= today),
    'yearCount', (SELECT count(*) FROM public.billing_documents d WHERE d.kind = 'INVOICE' AND d.issued_on >= year_start AND d.issued_on <= today),
    'monthNet', (SELECT coalesce(sum(CASE WHEN d.kind = 'INVOICE' THEN d.net_cents ELSE -d.net_cents END), 0)::bigint FROM public.billing_documents d
      WHERE d.issued_on >= month_start AND d.issued_on <= today),
    'monthCount', (SELECT count(*) FROM public.billing_documents d WHERE d.kind = 'INVOICE' AND d.issued_on >= month_start AND d.issued_on <= today),
    -- Not settled by any remittance: what the credit notes left of them, VAT included.
    'dueGross', (SELECT coalesce(sum(o.left_cents), 0)::bigint FROM (SELECT app.invoice_left(d.id) AS left_cents FROM public.billing_documents d
      WHERE d.kind = 'INVOICE' AND app.invoice_settled_on(d.id) IS NULL) o WHERE o.left_cents > 0),
    'dueCount', (SELECT count(*) FROM (SELECT app.invoice_left(d.id) AS left_cents FROM public.billing_documents d
      WHERE d.kind = 'INVOICE' AND app.invoice_settled_on(d.id) IS NULL) o WHERE o.left_cents > 0)
  );
END
$$;

GRANT EXECUTE ON FUNCTION app.billing_overview() TO legarec_staff;
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM legarec_definer;
