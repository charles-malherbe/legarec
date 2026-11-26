-- What a creditor reads of its remittances in its space: those made, and the next one as the same computation sees it today.
-- The computation of the batch is split: `app.remittance_core` (no check, granted to nobody) under the two doors that check
-- who calls, the batch for the Director and this space for the creditor, its own only.

GRANT CREATE ON SCHEMA app TO legarec_definer;
SET LOCAL ROLE legarec_definer;

CREATE FUNCTION app.remittance_core(until date, only_creditor uuid)
RETURNS TABLE (creditor_id uuid, case_id uuid, payment_id uuid, kind remittance_line_kind, amount_cents bigint, fee_net_cents bigint, has_mandate boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  WITH paid AS (
    SELECT p.id, p.case_id, p.creditor_id, p.amount_cents::bigint AS amount, m.id IS NOT NULL AS has_mandate,
      round(p.amount_cents::numeric * (CASE WHEN coalesce(p.settled_in_litigation, c.status = 'LITIGATION') THEN m.litigation_rate_bp ELSE m.amicable_rate_bp END) / 10000)::bigint AS fee
    FROM public.payments p JOIN public.cases c ON c.id = p.case_id LEFT JOIN public.mandates m ON m.id = c.mandate_id
    WHERE (only_creditor IS NULL OR p.creditor_id = only_creditor) AND p.status IN ('CASHED', 'RECONCILED') AND p.settled_at IS NOT NULL
      AND (p.settled_at AT TIME ZONE 'Europe/Paris')::date <= until
      AND NOT EXISTS (SELECT 1 FROM public.remittance_lines l WHERE l.payment_id = p.id)
  )
  SELECT paid.creditor_id, paid.case_id, paid.id, 'PAYMENT'::remittance_line_kind, paid.amount, coalesce(paid.fee, 0), paid.has_mandate FROM paid
  UNION ALL
  -- The opening fee of a case, once, with its first remittance (question 156).
  SELECT DISTINCT ON (c.id) c.creditor_id, c.id, NULL::uuid, 'OPENING_FEE'::remittance_line_kind, 0::bigint, m.opening_fee_cents::bigint, true
  FROM paid JOIN public.cases c ON c.id = paid.case_id JOIN public.mandates m ON m.id = c.mandate_id
  WHERE m.opening_fee_cents > 0 AND NOT EXISTS (SELECT 1 FROM public.remittance_lines l WHERE l.case_id = c.id AND l.kind = 'OPENING_FEE')
$$;

CREATE OR REPLACE FUNCTION app.remittance_sources(until date)
RETURNS TABLE (creditor_id uuid, case_id uuid, payment_id uuid, kind remittance_line_kind, amount_cents bigint, fee_net_cents bigint, has_mandate boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT * FROM app.remittance_core(until, NULL) WHERE app.acts_as_director('ADMINISTRATIVE')
$$;

-- Its own only: the remittances made (READY waits for the transfer, PAID is done), the next one, and the rate of its mandate.
CREATE FUNCTION app.creditor_payouts() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  own uuid := app.partner_creditor();
  yesterday date := (now() AT TIME ZONE 'Europe/Paris')::date - 1;
  upcoming record;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'CREDITOR' OR own IS NULL THEN
    PERFORM app.refuse('42501');
  END IF;
  SELECT * INTO upcoming FROM app.remittance_summary((SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]') FROM app.remittance_core(yesterday, own) x)) s WHERE s.creditor_id = own;
  RETURN jsonb_build_object(
    'rateBp', (SELECT m.amicable_rate_bp FROM public.mandates m WHERE m.creditor_id = own AND m.starts_on <= yesterday + 1 AND (m.ends_on IS NULL OR m.ends_on > yesterday)
      ORDER BY m.starts_on DESC LIMIT 1),
    'frequency', (SELECT s.value #>> '{}' FROM public.settings s WHERE s.key = 'firm.reversements.frequency'),
    'next', jsonb_build_object('collected', coalesce(upcoming.collected_cents, 0), 'fee', coalesce(upcoming.fee_net_cents + upcoming.fee_vat_cents, 0),
      'net', coalesce(upcoming.to_pay_cents, 0)),
    'items', coalesce((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'state', r.state, 'on', coalesce(b.paid_on, (b.validated_at AT TIME ZONE 'Europe/Paris')::date),
        'count', r.payments, 'collected', r.collected_cents, 'fee', r.fee_gross_cents, 'net', r.to_pay_cents) ORDER BY b.validated_at DESC)
      FROM public.remittances r JOIN public.remittance_batches b ON b.id = r.batch_id WHERE r.creditor_id = own AND r.state IN ('READY', 'PAID')), '[]')
  );
END
$$;
GRANT EXECUTE ON FUNCTION app.creditor_payouts() TO legarec_partner;
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM legarec_definer;
