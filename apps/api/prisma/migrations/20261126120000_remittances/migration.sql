-- Remittances to the creditors and the invoices of the commission (docs/propositions, « Validation des reversements » ;
-- question 69, R1 to R8). One function computes the batch, for what is shown and for what is validated: the amounts are
-- never typed, and the validation refuses a batch that changed since it was shown.

CREATE TYPE remittance_state AS ENUM ('READY', 'BELOW_MINIMUM', 'NO_ACCOUNT', 'NO_MANDATE', 'RETAINED', 'PAID');
CREATE TYPE remittance_batch_status AS ENUM ('VALIDATED', 'PAID');
CREATE TYPE remittance_line_kind AS ENUM ('PAYMENT', 'OPENING_FEE');
CREATE TYPE billing_kind AS ENUM ('INVOICE', 'CREDIT_NOTE');

CREATE TABLE remittance_batches (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  covers_until date NOT NULL,
  status remittance_batch_status NOT NULL DEFAULT 'VALIDATED',
  total_cents bigint NOT NULL CHECK (total_cents >= 0),
  transfers integer NOT NULL CHECK (transfers >= 0),
  validated_by uuid NOT NULL REFERENCES users (id),
  on_behalf_of_id uuid REFERENCES users (id),
  validated_at timestamptz(3) NOT NULL DEFAULT now(),
  paid_on date,
  paid_by uuid REFERENCES users (id),
  CHECK ((status = 'PAID') = (paid_on IS NOT NULL))
);

-- Invoices of the firm (FA-AAAA-NNNN) and credit notes (AV-AAAA-NNNN, V1): immutable once issued.
CREATE TABLE billing_documents (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  kind billing_kind NOT NULL,
  number text NOT NULL UNIQUE CHECK (number ~ '^(FA|AV)-[0-9]{4}-[0-9]{4,}$'),
  creditor_id uuid NOT NULL REFERENCES creditors (id),
  issued_on date NOT NULL,
  net_cents bigint NOT NULL,
  vat_cents bigint NOT NULL,
  gross_cents bigint NOT NULL CHECK (gross_cents = net_cents + vat_cents),
  corrected_id uuid REFERENCES billing_documents (id),
  reason text CHECK (length(reason) <= 1000),
  created_by uuid NOT NULL REFERENCES users (id),
  on_behalf_of_id uuid REFERENCES users (id),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  CHECK ((kind = 'CREDIT_NOTE') = (corrected_id IS NOT NULL))
);
CREATE TABLE billing_lines (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  document_id uuid NOT NULL REFERENCES billing_documents (id),
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 200),
  net_cents bigint NOT NULL,
  vat_cents bigint NOT NULL,
  gross_cents bigint NOT NULL CHECK (gross_cents = net_cents + vat_cents)
);
CREATE INDEX billing_lines_document ON billing_lines (document_id);

CREATE TABLE remittances (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  batch_id uuid NOT NULL REFERENCES remittance_batches (id),
  creditor_id uuid NOT NULL REFERENCES creditors (id),
  state remittance_state NOT NULL CHECK (state IN ('READY', 'RETAINED', 'PAID')),
  payments integer NOT NULL CHECK (payments >= 0),
  collected_cents bigint NOT NULL CHECK (collected_cents >= 0),
  fee_net_cents bigint NOT NULL,
  fee_vat_cents bigint NOT NULL,
  fee_gross_cents bigint NOT NULL CHECK (fee_gross_cents = fee_net_cents + fee_vat_cents),
  to_pay_cents bigint NOT NULL CHECK (to_pay_cents >= 0),
  bank_account_id uuid REFERENCES creditor_bank_accounts (id),
  invoice_id uuid REFERENCES billing_documents (id),
  reason text CHECK (length(reason) <= 500),
  UNIQUE (batch_id, creditor_id),
  CHECK ((state = 'RETAINED') = (reason IS NOT NULL))
);

-- What a remittance took: each payment once, each opening fee once.
CREATE TABLE remittance_lines (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  remittance_id uuid NOT NULL REFERENCES remittances (id),
  case_id uuid NOT NULL,
  creditor_id uuid NOT NULL,
  kind remittance_line_kind NOT NULL,
  payment_id uuid REFERENCES payments (id),
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0),
  fee_net_cents bigint NOT NULL CHECK (fee_net_cents >= 0),
  fee_vat_cents bigint NOT NULL CHECK (fee_vat_cents >= 0),
  FOREIGN KEY (case_id, creditor_id) REFERENCES cases (id, creditor_id),
  CHECK ((kind = 'PAYMENT') = (payment_id IS NOT NULL))
);
CREATE UNIQUE INDEX remittance_lines_payment ON remittance_lines (payment_id) WHERE kind = 'PAYMENT';
CREATE UNIQUE INDEX remittance_lines_opening ON remittance_lines (case_id) WHERE kind = 'OPENING_FEE';

ALTER TABLE payments ADD COLUMN settled_in_litigation boolean;
-- Those settled before: the state of their case now, the best that is known.
UPDATE payments p SET settled_in_litigation = (c.status = 'LITIGATION') FROM cases c WHERE c.id = p.case_id AND p.status IN ('CASHED', 'RECONCILED');

GRANT CREATE ON SCHEMA app TO legarec_definer;
GRANT SELECT, INSERT, UPDATE (status, paid_on, paid_by) ON remittance_batches TO legarec_definer;
GRANT SELECT, INSERT, UPDATE (state) ON remittances TO legarec_definer;
GRANT SELECT, INSERT ON remittance_lines, billing_documents, billing_lines TO legarec_definer;
GRANT SELECT (id, case_id, creditor_id, amount_cents, status, settled_at, settled_in_litigation) ON payments TO legarec_definer;
GRANT SELECT (id, creditor_id, status, mandate_id, opened_on) ON cases TO legarec_definer;
GRANT SELECT (id, creditor_id, starts_on, ends_on, amicable_rate_bp, litigation_rate_bp, opening_fee_cents, defer_small_remittances) ON mandates TO legarec_definer;
GRANT SELECT (id, creditor_id, iban_masked, valid_until, confirmed_at) ON creditor_bank_accounts TO legarec_definer;
GRANT SELECT (id, name) ON creditors TO legarec_definer;
GRANT SELECT (id, first_name, last_name) ON users TO legarec_definer;
SET LOCAL ROLE legarec_definer;

-- What the batch would be with every payment settled until `until`: one row per payment or opening fee not yet remitted.
-- The commission is that of the mandate of the case (C2): litigation rate for a payment settled while the case was in
-- litigation, amicable otherwise; on every sum collected (question 103). Before tax: the tax is that of each line of the
-- invoice.
CREATE FUNCTION app.remittance_sources(until date)
RETURNS TABLE (creditor_id uuid, case_id uuid, payment_id uuid, kind remittance_line_kind, amount_cents bigint, fee_net_cents bigint, has_mandate boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  WITH paid AS (
    SELECT p.id, p.case_id, p.creditor_id, p.amount_cents::bigint AS amount, m.id IS NOT NULL AS has_mandate,
      round(p.amount_cents::numeric * (CASE WHEN coalesce(p.settled_in_litigation, c.status = 'LITIGATION') THEN m.litigation_rate_bp ELSE m.amicable_rate_bp END) / 10000)::bigint AS fee
    FROM public.payments p JOIN public.cases c ON c.id = p.case_id LEFT JOIN public.mandates m ON m.id = c.mandate_id
    WHERE app.acts_as_director('ADMINISTRATIVE') AND p.status IN ('CASHED', 'RECONCILED') AND p.settled_at IS NOT NULL
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

-- One row per creditor, from sources read once: what is shown and what is validated come from the same reading.
CREATE FUNCTION app.remittance_summary(sources jsonb)
RETURNS TABLE (creditor_id uuid, creditor text, state remittance_state, payments integer, collected_cents bigint, fee_net_cents bigint, fee_vat_cents bigint,
  to_pay_cents bigint, bank_account_id uuid, account text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  -- « 1 000 € » as well as « 100 € »: spaces, even unbreakable, are not part of the number.
  minimum_cents bigint := coalesce((SELECT round(replace(substring(translate(s.value #>> '{}', ' ' || chr(160) || chr(8239), '') FROM '[0-9]+(?:[,.][0-9]+)?'), ',', '.')::numeric * 100)::bigint
    FROM public.settings s WHERE s.key = 'firm.reversements.minimum'), 10000);
BEGIN
  RETURN QUERY
  WITH lines AS (
    SELECT * FROM jsonb_to_recordset(sources) AS x (creditor_id uuid, case_id uuid, payment_id uuid, kind remittance_line_kind, amount_cents bigint, fee_net_cents bigint, has_mandate boolean)
  ), kinds AS (
    -- The tax of each line of the invoice: one per kind.
    SELECT l.creditor_id, sum(l.fee_net_cents)::bigint AS net, round(sum(l.fee_net_cents) * 0.2)::bigint AS vat FROM lines l GROUP BY l.creditor_id, l.kind
  ), sums AS (
    SELECT l.creditor_id, count(l.payment_id)::integer AS payments, sum(l.amount_cents)::bigint AS collected, bool_and(l.has_mandate) AS all_mandated,
      (SELECT sum(k.net)::bigint FROM kinds k WHERE k.creditor_id = l.creditor_id) AS net, (SELECT sum(k.vat)::bigint FROM kinds k WHERE k.creditor_id = l.creditor_id) AS vat
    FROM lines l GROUP BY l.creditor_id
  ), accounts AS (
    SELECT DISTINCT ON (a.creditor_id) a.creditor_id, a.id, a.iban_masked FROM public.creditor_bank_accounts a
    WHERE a.valid_until IS NULL AND a.confirmed_at IS NOT NULL ORDER BY a.creditor_id, a.confirmed_at DESC
  ), deferring AS (
    SELECT DISTINCT ON (m.creditor_id) m.creditor_id, m.defer_small_remittances FROM public.mandates m
    WHERE m.starts_on <= (now() AT TIME ZONE 'Europe/Paris')::date AND (m.ends_on IS NULL OR m.ends_on >= (now() AT TIME ZONE 'Europe/Paris')::date)
    ORDER BY m.creditor_id, m.starts_on DESC
  )
  SELECT s.creditor_id, k.name,
    (CASE
      WHEN NOT s.all_mandated THEN 'NO_MANDATE'
      WHEN a.id IS NULL THEN 'NO_ACCOUNT'
      -- Nothing to transfer, or under the threshold that the mandate defers (R3).
      WHEN s.collected - s.net - s.vat <= 0 OR (coalesce(d.defer_small_remittances, false) AND s.collected - s.net - s.vat < minimum_cents) THEN 'BELOW_MINIMUM'
      ELSE 'READY'
    END)::remittance_state,
    s.payments, s.collected, s.net, s.vat, greatest(s.collected - s.net - s.vat, 0), a.id, a.iban_masked
  FROM sums s JOIN public.creditors k ON k.id = s.creditor_id LEFT JOIN accounts a ON a.creditor_id = s.creditor_id LEFT JOIN deferring d ON d.creditor_id = s.creditor_id
  ORDER BY k.name, s.creditor_id;
END
$$;

CREATE FUNCTION app.remittance_draft(until date)
RETURNS TABLE (creditor_id uuid, creditor text, state remittance_state, payments integer, collected_cents bigint, fee_net_cents bigint, fee_vat_cents bigint,
  to_pay_cents bigint, bank_account_id uuid, account text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'STAFF' OR NOT app.acts_as_director('ADMINISTRATIVE') THEN
    PERFORM app.refuse('42501');
  END IF;
  RETURN QUERY SELECT * FROM app.remittance_summary((SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]') FROM app.remittance_sources(until) x));
END
$$;

-- The validation: the batch as it was shown, creditor by creditor (amount and account), or nothing. The sources are read
-- once, after the lock; each READY creditor gets its remittance and the invoice of what the firm retained (R8); a retained
-- one keeps its payments for the next batch (R7).
CREATE FUNCTION app.validate_remittances(until date, expected jsonb, retained_ids uuid[], reasons text[]) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  batch uuid := app.uuid_v7();
  item record;
  made uuid;
  invoice uuid;
  numbered record;
  sources jsonb;
  summary jsonb;
  total bigint;
  transfers integer;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'STAFF' OR NOT app.acts_as_director('ADMINISTRATIVE') THEN
    PERFORM app.refuse('42501');
  END IF;
  IF cardinality(retained_ids) IS DISTINCT FROM cardinality(reasons) OR jsonb_typeof(expected) IS DISTINCT FROM 'array'
    OR EXISTS (SELECT 1 FROM unnest(reasons) r WHERE r IS NULL OR length(btrim(r)) NOT BETWEEN 1 AND 500)
    OR (SELECT count(DISTINCT x) FROM unnest(retained_ids) x) <> cardinality(retained_ids) THEN
    PERFORM app.refuse('22023');
  END IF;
  -- Until the day before (R2): a batch shown yesterday and validated after midnight has changed.
  IF until <> (now() AT TIME ZONE 'Europe/Paris')::date - 1 THEN
    PERFORM app.refuse('LG409');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('remittances', 0));
  sources := (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]') FROM app.remittance_sources(until) x);
  summary := (SELECT coalesce(jsonb_agg(to_jsonb(d)), '[]') FROM app.remittance_summary(sources) d);
    IF EXISTS (SELECT 1 FROM unnest(retained_ids) r WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_to_recordset(summary) AS d (creditor_id uuid, state remittance_state) WHERE d.creditor_id = r AND d.state = 'READY')) THEN
    PERFORM app.refuse('LG409');
  END IF;
  -- Creditor by creditor: the same amount towards the same account as shown.
  IF EXISTS (
    (SELECT d.creditor_id, d.to_pay_cents, d.bank_account_id FROM jsonb_to_recordset(summary) AS d (creditor_id uuid, state remittance_state, to_pay_cents bigint, bank_account_id uuid)
     WHERE d.state = 'READY' AND d.creditor_id <> ALL (retained_ids)
     EXCEPT SELECT e.creditor_id, e.to_pay_cents, e.bank_account_id FROM jsonb_to_recordset(expected) AS e (creditor_id uuid, to_pay_cents bigint, bank_account_id uuid))
    UNION ALL
    (SELECT e.creditor_id, e.to_pay_cents, e.bank_account_id FROM jsonb_to_recordset(expected) AS e (creditor_id uuid, to_pay_cents bigint, bank_account_id uuid)
     EXCEPT SELECT d.creditor_id, d.to_pay_cents, d.bank_account_id FROM jsonb_to_recordset(summary) AS d (creditor_id uuid, state remittance_state, to_pay_cents bigint, bank_account_id uuid)
     WHERE d.state = 'READY' AND d.creditor_id <> ALL (retained_ids))
  ) THEN
    PERFORM app.refuse('LG409');
  END IF;
  SELECT coalesce(sum(d.to_pay_cents), 0), count(*) INTO total, transfers
  FROM jsonb_to_recordset(summary) AS d (creditor_id uuid, state remittance_state, to_pay_cents bigint) WHERE d.state = 'READY' AND d.creditor_id <> ALL (retained_ids);
  IF transfers = 0 THEN
    PERFORM app.refuse('LG409');
  END IF;
  INSERT INTO public.remittance_batches (id, covers_until, total_cents, transfers, validated_by, on_behalf_of_id)
  VALUES (batch, until, total, transfers, app.user_id(), app.on_behalf_of());
  FOR item IN
    SELECT d.*, r.reason FROM jsonb_to_recordset(summary) AS d (creditor_id uuid, state remittance_state, payments integer, collected_cents bigint, fee_net_cents bigint,
      fee_vat_cents bigint, to_pay_cents bigint, bank_account_id uuid)
    LEFT JOIN unnest(retained_ids, reasons) AS r (creditor_id, reason) ON r.creditor_id = d.creditor_id WHERE d.state = 'READY'
  LOOP
    made := app.uuid_v7();
    invoice := NULL;
    IF item.reason IS NULL AND item.fee_net_cents > 0 THEN
      SELECT * INTO numbered FROM app.next_number('INVOICE');
      invoice := app.uuid_v7();
      INSERT INTO public.billing_documents (id, kind, number, creditor_id, issued_on, net_cents, vat_cents, gross_cents, created_by, on_behalf_of_id)
      VALUES (invoice, 'INVOICE', 'FA-' || numbered.for_year || '-' || lpad(numbered.number::text, 4, '0'), item.creditor_id, (now() AT TIME ZONE 'Europe/Paris')::date,
        item.fee_net_cents, item.fee_vat_cents, item.fee_net_cents + item.fee_vat_cents, app.user_id(), app.on_behalf_of());
      -- The same lines as the summary: their tax adds up to that of the invoice.
      INSERT INTO public.billing_lines (document_id, label, net_cents, vat_cents, gross_cents)
      SELECT invoice, CASE s.kind WHEN 'PAYMENT' THEN 'Honoraires de recouvrement' ELSE 'Frais d’ouverture de dossier' END,
        sum(s.fee_net_cents), round(sum(s.fee_net_cents) * 0.2), sum(s.fee_net_cents) + round(sum(s.fee_net_cents) * 0.2)
      FROM jsonb_to_recordset(sources) AS s (creditor_id uuid, kind remittance_line_kind, fee_net_cents bigint) WHERE s.creditor_id = item.creditor_id GROUP BY s.kind;
    END IF;
    INSERT INTO public.remittances (id, batch_id, creditor_id, state, payments, collected_cents, fee_net_cents, fee_vat_cents, fee_gross_cents, to_pay_cents,
      bank_account_id, invoice_id, reason)
    VALUES (made, batch, item.creditor_id, (CASE WHEN item.reason IS NULL THEN 'READY' ELSE 'RETAINED' END)::remittance_state, item.payments, item.collected_cents,
      item.fee_net_cents, item.fee_vat_cents, item.fee_net_cents + item.fee_vat_cents, item.to_pay_cents, item.bank_account_id, invoice, nullif(btrim(item.reason), ''));
    IF item.reason IS NULL THEN
      INSERT INTO public.remittance_lines (remittance_id, case_id, creditor_id, kind, payment_id, amount_cents, fee_net_cents, fee_vat_cents)
      SELECT made, s.case_id, s.creditor_id, s.kind, s.payment_id, s.amount_cents, s.fee_net_cents, round(s.fee_net_cents * 0.2)
      FROM jsonb_to_recordset(sources) AS s (creditor_id uuid, case_id uuid, payment_id uuid, kind remittance_line_kind, amount_cents bigint, fee_net_cents bigint)
      WHERE s.creditor_id = item.creditor_id;
    ELSE
      PERFORM app.log('REMITTANCE_RETAINED', 'remittance', made, '{}'::jsonb);
    END IF;
  END LOOP;
  PERFORM app.log('REMITTANCES_VALIDATED', 'remittance_batch', batch, jsonb_build_object('count', least(transfers, 999)));
  RETURN batch;
END
$$;

-- Transfers made at the bank (R5), then said here; refused if an account of the batch was replaced since.
CREATE FUNCTION app.mark_remittances_paid(batch uuid, paid date, expected_total bigint) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'STAFF' OR NOT app.acts_as_director('ADMINISTRATIVE') THEN
    PERFORM app.refuse('42501');
  END IF;
  IF paid > (now() AT TIME ZONE 'Europe/Paris')::date THEN
    PERFORM app.refuse('22023');
  END IF;
  IF EXISTS (SELECT 1 FROM public.remittances r JOIN public.creditor_bank_accounts a ON a.id = r.bank_account_id WHERE r.batch_id = batch AND r.state = 'READY' AND a.valid_until IS NOT NULL) THEN
    PERFORM app.refuse('LG409');
  END IF;
  UPDATE public.remittance_batches b SET status = 'PAID', paid_on = paid, paid_by = app.user_id()
  WHERE b.id = batch AND b.status = 'VALIDATED' AND b.total_cents = expected_total AND paid >= (b.validated_at AT TIME ZONE 'Europe/Paris')::date;
  IF NOT FOUND THEN
    PERFORM app.refuse('LG409');
  END IF;
  UPDATE public.remittances r SET state = 'PAID' WHERE r.batch_id = batch AND r.state = 'READY';
  PERFORM app.log('REMITTANCES_PAID', 'remittance_batch', batch, '{}'::jsonb);
END
$$;

CREATE FUNCTION app.remittance_batches(wanted uuid DEFAULT NULL)
RETURNS TABLE (id uuid, covers_until date, status remittance_batch_status, total_cents bigint, transfers integer, validated_at timestamptz, validated_by text, paid_on date)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'STAFF' OR NOT app.acts_as_director('ADMINISTRATIVE') THEN
    PERFORM app.refuse('42501');
  END IF;
  RETURN QUERY SELECT b.id, b.covers_until, b.status, b.total_cents, b.transfers, b.validated_at, u.first_name || ' ' || u.last_name, b.paid_on
  FROM public.remittance_batches b JOIN public.users u ON u.id = b.validated_by WHERE wanted IS NULL OR b.id = wanted ORDER BY b.validated_at DESC LIMIT 200;
END
$$;

CREATE FUNCTION app.remittance_batch(batch uuid)
RETURNS TABLE (creditor_id uuid, creditor text, state remittance_state, payments integer, collected_cents bigint, fee_net_cents bigint, fee_vat_cents bigint,
  to_pay_cents bigint, bank_account_id uuid, account text, invoice text, reason text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'STAFF' OR NOT app.acts_as_director('ADMINISTRATIVE') THEN
    PERFORM app.refuse('42501');
  END IF;
  RETURN QUERY SELECT r.creditor_id, k.name, r.state, r.payments, r.collected_cents, r.fee_net_cents, r.fee_vat_cents, r.to_pay_cents, r.bank_account_id, a.iban_masked, d.number, r.reason
  FROM public.remittances r JOIN public.creditors k ON k.id = r.creditor_id LEFT JOIN public.creditor_bank_accounts a ON a.id = r.bank_account_id
    LEFT JOIN public.billing_documents d ON d.id = r.invoice_id
  WHERE r.batch_id = batch ORDER BY k.name, r.creditor_id;
END
$$;

GRANT EXECUTE ON FUNCTION app.remittance_draft(date), app.validate_remittances(date, jsonb, uuid[], text[]), app.mark_remittances_paid(uuid, date, bigint),
  app.remittance_batches(uuid), app.remittance_batch(uuid) TO legarec_staff;
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM legarec_definer;

-- The rate is that of the state of the case when the payment is settled, not when the batch is made: changing the status of
-- a case later changes nothing of its commission (security review).
CREATE FUNCTION app.note_settlement() RETURNS trigger
-- Runs with the rights of who settles the payment (the functions of the money).
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.status IN ('CASHED', 'RECONCILED') AND OLD.status IS DISTINCT FROM NEW.status THEN
    NEW.settled_in_litigation := (SELECT c.status = 'LITIGATION' FROM public.cases c WHERE c.id = NEW.case_id);
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER note_settlement BEFORE UPDATE OF status ON payments FOR EACH ROW EXECUTE FUNCTION app.note_settlement();

CALL app.secure('remittance_batches');
CALL app.secure('remittances');
CALL app.secure_case_table('remittance_lines');
CALL app.secure('billing_documents');
CALL app.secure('billing_lines');
CREATE POLICY definer_all ON remittance_batches TO legarec_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON remittances TO legarec_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON remittance_lines TO legarec_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON billing_documents TO legarec_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON billing_lines TO legarec_definer USING (true) WITH CHECK (true);
-- Issued, an invoice or a credit note never changes: a correction is another credit note (HANDOFF.md).
CALL app.append_only('billing_documents');
CALL app.append_only('billing_lines');
CALL app.append_only('remittance_lines');
