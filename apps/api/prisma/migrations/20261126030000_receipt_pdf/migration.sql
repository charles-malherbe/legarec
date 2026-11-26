-- The PDF of a receipt is written by the worker, as soon as the receipt is issued (`receipt-pdf`, file `pdf`).

GRANT CREATE ON SCHEMA app TO legarec_definer;
SET LOCAL ROLE legarec_definer;
CREATE OR REPLACE FUNCTION app.issue_receipt(paid uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  next record;
  issued uuid := app.uuid_v7();
BEGIN
  SELECT * INTO next FROM app.next_number('RECEIPT');
  INSERT INTO public.receipts (id, case_id, creditor_id, payment_id, number)
  SELECT issued, p.case_id, p.creditor_id, p.id, format('Q-%s-%s', next.for_year, lpad(next.number::text, 5, '0'))
  FROM public.payments p WHERE p.id = paid AND p.status IN ('CASHED', 'RECONCILED');
  IF NOT FOUND THEN
    PERFORM app.refuse('LG409');
  END IF;
  PERFORM app.enqueue('pdf', 'receipt-pdf', jsonb_build_object('receipt', issued), 'receipt:' || issued::text, NULL);
END
$$;
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM legarec_definer;
GRANT INSERT (id) ON receipts TO legarec_definer;
