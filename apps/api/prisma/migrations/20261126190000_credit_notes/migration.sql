-- Credit notes (docs/propositions, « Avoir » ; question 69, V1, V2, V4, V5, E2, E6, R6). A credit note cites the invoice it
-- corrects, line by line, takes its tax again and never changes once issued; the invoice never changes either: its
-- status (partial credit, cancelled by a credit note) is derived from the credit notes that cite it. Numbered AV-AAAA-NNNN,
-- a continuous series of its own (V1), at issuance only: a draft has no number and may be deleted.

CREATE TYPE credit_note_scope AS ENUM ('PARTIAL', 'TOTAL');
-- What becomes of the amount (V2): an invoice settled (retained from a remittance) is given back with the next remittance or
-- by a transfer made by hand; an invoice not settled is reduced by as much.
CREATE TYPE credit_note_follow_up AS ENUM ('NEXT_REMITTANCE', 'TRANSFER', 'DEDUCTED');

-- E6: the scope and the follow-up of a credit note; the line of the invoice that each of its lines corrects.
ALTER TABLE billing_documents ADD COLUMN scope credit_note_scope;
ALTER TABLE billing_documents ADD COLUMN follow_up credit_note_follow_up;
ALTER TABLE billing_documents ADD CONSTRAINT billing_documents_credit_note_check
  CHECK ((kind = 'CREDIT_NOTE') = (scope IS NOT NULL AND follow_up IS NOT NULL AND reason IS NOT NULL));
ALTER TABLE billing_documents ADD CONSTRAINT billing_documents_amounts_check CHECK (net_cents >= 0 AND vat_cents >= 0);
ALTER TABLE billing_lines ADD COLUMN corrected_line_id uuid REFERENCES billing_lines (id);
CREATE INDEX billing_lines_corrected ON billing_lines (corrected_line_id) WHERE corrected_line_id IS NOT NULL;
CREATE INDEX billing_documents_corrected ON billing_documents (corrected_id) WHERE corrected_id IS NOT NULL;

-- E2: a credit note given back with the next remittance of its creditor; the remittance that took it, once.
CREATE TABLE credit_note_refunds (
  credit_note_id uuid PRIMARY KEY REFERENCES billing_documents (id),
  creditor_id uuid NOT NULL REFERENCES creditors (id),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  remittance_id uuid REFERENCES remittances (id),
  created_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX credit_note_refunds_waiting ON credit_note_refunds (creditor_id) WHERE remittance_id IS NULL;

-- A draft: what was typed, without a number; changed or deleted until it is issued.
CREATE TABLE credit_note_drafts (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  invoice_id uuid NOT NULL REFERENCES billing_documents (id),
  scope credit_note_scope NOT NULL,
  lines jsonb NOT NULL CHECK (jsonb_typeof(lines) = 'array' AND jsonb_array_length(lines) <= 50),
  reason text NOT NULL CHECK (length(reason) <= 1000),
  follow_up credit_note_follow_up,
  created_by uuid NOT NULL REFERENCES users (id),
  on_behalf_of_id uuid REFERENCES users (id),
  updated_at timestamptz(3) NOT NULL DEFAULT now()
);

GRANT CREATE ON SCHEMA app TO legarec_definer;
GRANT SELECT, INSERT, UPDATE (remittance_id) ON credit_note_refunds TO legarec_definer;
GRANT SELECT, INSERT, UPDATE (scope, lines, reason, follow_up, updated_at), DELETE ON credit_note_drafts TO legarec_definer;
SET LOCAL ROLE legarec_definer;

-- The invoices of the firm as a credit note sees them: what each line still bills, and how much the invoice still bills.
CREATE FUNCTION app.invoice_lines_left(invoice uuid)
RETURNS TABLE (id uuid, label text, net_cents bigint, vat_cents bigint, left_net_cents bigint, left_vat_cents bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT l.id, l.label, l.net_cents, l.vat_cents, l.net_cents - coalesce(sum(c.net_cents), 0)::bigint, l.vat_cents - coalesce(sum(c.vat_cents), 0)::bigint
  FROM public.billing_lines l LEFT JOIN public.billing_lines c ON c.corrected_line_id = l.id
  WHERE l.document_id = invoice
  GROUP BY l.id, l.label, l.net_cents, l.vat_cents
  ORDER BY l.id
$$;

CREATE FUNCTION app.invoice_left(invoice uuid) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT d.gross_cents - coalesce((SELECT sum(c.gross_cents) FROM public.billing_documents c WHERE c.corrected_id = d.id AND c.kind = 'CREDIT_NOTE'), 0)::bigint
  FROM public.billing_documents d WHERE d.id = invoice AND d.kind = 'INVOICE'
$$;

-- Settled: its commission was retained from a remittance (R1, R8). The day of that remittance.
CREATE FUNCTION app.invoice_settled_on(invoice uuid) RETURNS date
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT coalesce(b.paid_on, (b.validated_at AT TIME ZONE 'Europe/Paris')::date)
  FROM public.remittances r JOIN public.remittance_batches b ON b.id = r.batch_id
  WHERE r.invoice_id = invoice AND r.state IN ('READY', 'PAID')
  LIMIT 1
$$;

-- What the screen « Avoir » reads: the invoices that may still be corrected, the credit notes issued, the drafts, and the
-- number the next credit note would take (shown as provisional: it is drawn at the issuance only).
CREATE FUNCTION app.credit_notes() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  this_year integer := extract(year FROM now() AT TIME ZONE 'Europe/Paris');
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'STAFF' OR NOT app.acts_as_director('ADMINISTRATIVE') THEN
    PERFORM app.refuse('42501');
  END IF;
  RETURN jsonb_build_object(
    'invoices', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', d.id, 'number', d.number, 'issuedOn', d.issued_on, 'creditorId', d.creditor_id, 'net', d.net_cents,
          'vat', d.vat_cents, 'gross', d.gross_cents, 'left', d.left_cents, 'settledOn', app.invoice_settled_on(d.id),
          'credited', (SELECT count(*) FROM public.billing_documents c WHERE c.corrected_id = d.id),
          'lines', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'label', l.label, 'net', l.net_cents, 'vat', l.vat_cents, 'leftNet', l.left_net_cents,
            'leftVat', l.left_vat_cents)), '[]') FROM app.invoice_lines_left(d.id) l))
        ORDER BY d.issued_on DESC, d.number DESC)
      FROM (SELECT i.*, app.invoice_left(i.id) AS left_cents FROM public.billing_documents i WHERE i.kind = 'INVOICE' ORDER BY i.issued_on DESC, i.number DESC LIMIT 500) d
      WHERE d.left_cents > 0), '[]'),
    'items', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', c.id, 'number', c.number, 'issuedOn', c.issued_on, 'creditorId', c.creditor_id, 'invoiceId', i.id,
          'invoice', i.number, 'invoiceIssuedOn', i.issued_on, 'invoiceLeft', app.invoice_left(i.id), 'scope', c.scope, 'net', c.net_cents, 'vat', c.vat_cents,
          'gross', c.gross_cents, 'reason', c.reason, 'followUp', c.follow_up,
          'remittedOn', (SELECT coalesce(b.paid_on, (b.validated_at AT TIME ZONE 'Europe/Paris')::date) FROM public.credit_note_refunds f
            JOIN public.remittances r ON r.id = f.remittance_id JOIN public.remittance_batches b ON b.id = r.batch_id WHERE f.credit_note_id = c.id))
        ORDER BY c.number DESC)
      FROM (SELECT * FROM public.billing_documents x WHERE x.kind = 'CREDIT_NOTE' ORDER BY x.number DESC LIMIT 500) c
      JOIN public.billing_documents i ON i.id = c.corrected_id), '[]'),
    'drafts', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', r.id, 'invoiceId', r.invoice_id, 'invoice', i.number, 'creditorId', i.creditor_id, 'scope', r.scope,
          'lines', r.lines, 'reason', r.reason, 'followUp', r.follow_up, 'updatedAt', r.updated_at) ORDER BY r.updated_at DESC)
      FROM (SELECT * FROM public.credit_note_drafts x ORDER BY x.updated_at DESC LIMIT 100) r JOIN public.billing_documents i ON i.id = r.invoice_id), '[]'),
    'nextNumber', 'AV-' || this_year || '-' || lpad((coalesce((SELECT s.last_value FROM public.number_sequences s WHERE s.kind = 'CREDIT_NOTE' AND s.year = this_year), 0) + 1)::text, 4, '0')
  );
END
$$;

-- Lines of a credit note as typed: [{ "line_id": …, "net_cents": … }], each line of the invoice once at most.
CREATE FUNCTION app.check_credit_lines(invoice uuid, lines jsonb) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF jsonb_typeof(lines) IS DISTINCT FROM 'array' OR jsonb_array_length(lines) > 50
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(lines) e WHERE jsonb_typeof(e) <> 'object' OR jsonb_typeof(e -> 'net_cents') IS DISTINCT FROM 'number'
      OR jsonb_typeof(e -> 'line_id') IS DISTINCT FROM 'string')
    OR EXISTS (SELECT 1 FROM jsonb_to_recordset(lines) AS x (line_id uuid, net_cents numeric) WHERE x.net_cents < 0 OR x.net_cents > 100000000000 OR x.net_cents <> trunc(x.net_cents)
      OR NOT EXISTS (SELECT 1 FROM public.billing_lines l WHERE l.id = x.line_id AND l.document_id = invoice))
    OR (SELECT count(DISTINCT x.line_id) <> count(*) FROM jsonb_to_recordset(lines) AS x (line_id uuid)) THEN
    PERFORM app.refuse('22023');
  END IF;
END
$$;

-- Saves a draft (a new one when `draft` is null). Nothing of it is checked against what the invoice still bills: that is
-- done at the issuance.
CREATE FUNCTION app.save_credit_note_draft(draft uuid, invoice uuid, wanted_scope credit_note_scope, lines jsonb, reason text, follow credit_note_follow_up)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  saved uuid;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'STAFF' OR NOT app.acts_as_director('ADMINISTRATIVE') THEN
    PERFORM app.refuse('42501');
  END IF;
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

CREATE FUNCTION app.delete_credit_note_draft(draft uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'STAFF' OR NOT app.acts_as_director('ADMINISTRATIVE') THEN
    PERFORM app.refuse('42501');
  END IF;
  DELETE FROM public.credit_note_drafts d WHERE d.id = draft;
  IF NOT FOUND THEN
    PERFORM app.refuse('LG404');
  END IF;
END
$$;

-- The issuance: refused (LG409) if the invoice no longer bills what was shown (`expected_left`, with tax), or if it is
-- already cancelled. Each line: at most what it still bills; the tax of the line of the invoice, in proportion, and all
-- that is left of it when the line is credited in full. A total credit note takes every line in full, whatever was typed.
-- Under the lock of the remittances: a batch validated at the same time sees it, or not at all.
CREATE FUNCTION app.issue_credit_note(invoice uuid, wanted_scope credit_note_scope, lines jsonb, reason text, follow credit_note_follow_up,
  expected_left bigint, draft uuid) RETURNS TABLE (credit_note uuid, credit_number text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  made uuid := app.uuid_v7();
  credited jsonb;
  owner uuid;
  left_cents bigint;
  numbered record;
  net bigint;
  vat bigint;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'STAFF' OR NOT app.acts_as_director('ADMINISTRATIVE') THEN
    PERFORM app.refuse('42501');
  END IF;
  IF reason IS NULL OR length(btrim(reason)) NOT BETWEEN 1 AND 1000 OR follow IS NULL OR wanted_scope IS NULL THEN
    PERFORM app.refuse('22023');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('remittances', 0));
  SELECT d.creditor_id INTO owner FROM public.billing_documents d WHERE d.id = invoice AND d.kind = 'INVOICE';
  IF owner IS NULL THEN
    PERFORM app.refuse('LG404');
  END IF;
  left_cents := app.invoice_left(invoice);
  IF left_cents IS DISTINCT FROM expected_left OR left_cents <= 0 THEN
    PERFORM app.refuse('LG409');
  END IF;
  -- Settled: given back with the next remittance or by a transfer; not settled: deducted from the invoice (V2).
  IF (app.invoice_settled_on(invoice) IS NOT NULL) <> (follow IN ('NEXT_REMITTANCE', 'TRANSFER')) THEN
    PERFORM app.refuse('22023');
  END IF;
  PERFORM app.check_credit_lines(invoice, lines);
  credited := (
    SELECT coalesce(jsonb_agg(jsonb_build_object('line_id', l.id, 'label', l.label, 'net_cents', w.net,
      'vat_cents', CASE WHEN w.net = l.left_net_cents THEN l.left_vat_cents WHEN l.net_cents = 0 THEN 0 ELSE round(w.net::numeric * l.vat_cents / l.net_cents)::bigint END,
      'left_net', l.left_net_cents, 'left_vat', l.left_vat_cents)), '[]')
    FROM app.invoice_lines_left(invoice) l
    CROSS JOIN LATERAL (
      SELECT CASE WHEN wanted_scope = 'TOTAL' THEN l.left_net_cents
        ELSE coalesce((SELECT x.net_cents FROM jsonb_to_recordset(lines) AS x (line_id uuid, net_cents bigint) WHERE x.line_id = l.id), 0) END AS net
    ) w
    WHERE w.net > 0 OR (wanted_scope = 'TOTAL' AND l.left_vat_cents > 0));
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(credited) AS c (net_cents bigint, vat_cents bigint, left_net bigint, left_vat bigint)
    WHERE c.net_cents > c.left_net OR c.vat_cents > c.left_vat) THEN
    PERFORM app.refuse('22023');
  END IF;
  SELECT coalesce(sum(c.net_cents), 0), coalesce(sum(c.vat_cents), 0) INTO net, vat FROM jsonb_to_recordset(credited) AS c (net_cents bigint, vat_cents bigint);
  IF net + vat <= 0 OR net + vat > left_cents THEN
    PERFORM app.refuse('22023');
  END IF;
  SELECT * INTO numbered FROM app.next_number('CREDIT_NOTE');
  credit_note := made;
  credit_number := 'AV-' || numbered.for_year || '-' || lpad(numbered.number::text, 4, '0');
  INSERT INTO public.billing_documents (id, kind, number, creditor_id, issued_on, net_cents, vat_cents, gross_cents, corrected_id, reason, scope, follow_up,
    created_by, on_behalf_of_id)
  VALUES (made, 'CREDIT_NOTE', credit_number, owner, (now() AT TIME ZONE 'Europe/Paris')::date,
    net, vat, net + vat, invoice, btrim(reason), (CASE WHEN net + vat = left_cents THEN 'TOTAL' ELSE 'PARTIAL' END)::credit_note_scope, follow,
    app.user_id(), app.on_behalf_of());
  INSERT INTO public.billing_lines (document_id, label, net_cents, vat_cents, gross_cents, corrected_line_id)
  SELECT made, c.label, c.net_cents, c.vat_cents, c.net_cents + c.vat_cents, c.line_id
  FROM jsonb_to_recordset(credited) AS c (line_id uuid, label text, net_cents bigint, vat_cents bigint);
  IF follow = 'NEXT_REMITTANCE' THEN
    INSERT INTO public.credit_note_refunds (credit_note_id, creditor_id, amount_cents) VALUES (made, owner, net + vat);
  END IF;
  IF draft IS NOT NULL THEN
    DELETE FROM public.credit_note_drafts d WHERE d.id = draft AND d.invoice_id = invoice;
  END IF;
  PERFORM app.log('CREDIT_NOTE_ISSUED', 'billing_document', made, '{}'::jsonb);
  RETURN NEXT;
END
$$;

-- The next remittance gives back the credit notes waiting for it (E2): one more column, what they add to what is paid.
DROP FUNCTION app.remittance_draft(date);
DROP FUNCTION app.remittance_summary(jsonb);
DROP FUNCTION app.remittance_batch(uuid);

CREATE FUNCTION app.remittance_summary(sources jsonb)
RETURNS TABLE (creditor_id uuid, creditor text, state remittance_state, payments integer, collected_cents bigint, fee_net_cents bigint, fee_vat_cents bigint,
  to_pay_cents bigint, bank_account_id uuid, account text, credit_cents bigint)
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
  ), credits AS (
    -- Credit notes given back with the next remittance, not yet taken by one.
    SELECT f.creditor_id, sum(f.amount_cents)::bigint AS amount FROM public.credit_note_refunds f WHERE f.remittance_id IS NULL GROUP BY f.creditor_id
  ), sums AS (
    SELECT l.creditor_id, count(l.payment_id)::integer AS payments, sum(l.amount_cents)::bigint AS collected, bool_and(l.has_mandate) AS all_mandated,
      (SELECT sum(k.net)::bigint FROM kinds k WHERE k.creditor_id = l.creditor_id) AS net, (SELECT sum(k.vat)::bigint FROM kinds k WHERE k.creditor_id = l.creditor_id) AS vat
    FROM lines l GROUP BY l.creditor_id
    UNION ALL
    SELECT c.creditor_id, 0, 0::bigint, true, 0::bigint, 0::bigint FROM credits c WHERE NOT EXISTS (SELECT 1 FROM lines l WHERE l.creditor_id = c.creditor_id)
  ), accounts AS (
    SELECT DISTINCT ON (a.creditor_id) a.creditor_id, a.id, a.iban_masked FROM public.creditor_bank_accounts a
    WHERE a.valid_until IS NULL AND a.confirmed_at IS NOT NULL ORDER BY a.creditor_id, a.confirmed_at DESC
  ), deferring AS (
    SELECT DISTINCT ON (m.creditor_id) m.creditor_id, m.defer_small_remittances FROM public.mandates m
    WHERE m.starts_on <= (now() AT TIME ZONE 'Europe/Paris')::date AND (m.ends_on IS NULL OR m.ends_on >= (now() AT TIME ZONE 'Europe/Paris')::date)
    ORDER BY m.creditor_id, m.starts_on DESC
  ), owed AS (
    SELECT s.*, coalesce(c.amount, 0)::bigint AS credit, s.collected - s.net - s.vat + coalesce(c.amount, 0) AS due FROM sums s LEFT JOIN credits c ON c.creditor_id = s.creditor_id
  )
  SELECT s.creditor_id, k.name,
    (CASE
      WHEN NOT s.all_mandated THEN 'NO_MANDATE'
      WHEN a.id IS NULL THEN 'NO_ACCOUNT'
      -- Nothing to transfer, or under the threshold that the mandate defers (R3).
      WHEN s.due <= 0 OR (coalesce(d.defer_small_remittances, false) AND s.due < minimum_cents) THEN 'BELOW_MINIMUM'
      ELSE 'READY'
    END)::remittance_state,
    s.payments, s.collected, s.net, s.vat, greatest(s.due, 0), a.id, a.iban_masked, s.credit
  FROM owed s JOIN public.creditors k ON k.id = s.creditor_id LEFT JOIN accounts a ON a.creditor_id = s.creditor_id LEFT JOIN deferring d ON d.creditor_id = s.creditor_id
  ORDER BY k.name, s.creditor_id;
END
$$;

CREATE FUNCTION app.remittance_draft(until date)
RETURNS TABLE (creditor_id uuid, creditor text, state remittance_state, payments integer, collected_cents bigint, fee_net_cents bigint, fee_vat_cents bigint,
  to_pay_cents bigint, bank_account_id uuid, account text, credit_cents bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'STAFF' OR NOT app.acts_as_director('ADMINISTRATIVE') THEN
    PERFORM app.refuse('42501');
  END IF;
  RETURN QUERY SELECT * FROM app.remittance_summary((SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]') FROM app.remittance_sources(until) x));
END
$$;

CREATE FUNCTION app.remittance_batch(batch uuid)
RETURNS TABLE (creditor_id uuid, creditor text, state remittance_state, payments integer, collected_cents bigint, fee_net_cents bigint, fee_vat_cents bigint,
  to_pay_cents bigint, bank_account_id uuid, account text, invoice text, reason text, credit_cents bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'STAFF' OR NOT app.acts_as_director('ADMINISTRATIVE') THEN
    PERFORM app.refuse('42501');
  END IF;
  RETURN QUERY SELECT r.creditor_id, k.name, r.state, r.payments, r.collected_cents, r.fee_net_cents, r.fee_vat_cents, r.to_pay_cents, r.bank_account_id, a.iban_masked, d.number, r.reason,
    coalesce((SELECT sum(f.amount_cents) FROM public.credit_note_refunds f WHERE f.remittance_id = r.id), 0)::bigint
  FROM public.remittances r JOIN public.creditors k ON k.id = r.creditor_id LEFT JOIN public.creditor_bank_accounts a ON a.id = r.bank_account_id
    LEFT JOIN public.billing_documents d ON d.id = r.invoice_id
  WHERE r.batch_id = batch ORDER BY k.name, r.creditor_id;
END
$$;

-- As in 20261126120000_remittances, and the credit notes waiting for each creditor remitted are taken by its remittance:
-- the same ones as the summary counted, read after the same lock.
CREATE OR REPLACE FUNCTION app.validate_remittances(until date, expected jsonb, retained_ids uuid[], reasons text[]) RETURNS uuid
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
      fee_vat_cents bigint, to_pay_cents bigint, bank_account_id uuid, credit_cents bigint)
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
      UPDATE public.credit_note_refunds f SET remittance_id = made WHERE f.creditor_id = item.creditor_id AND f.remittance_id IS NULL;
    ELSE
      PERFORM app.log('REMITTANCE_RETAINED', 'remittance', made, '{}'::jsonb);
    END IF;
  END LOOP;
  PERFORM app.log('REMITTANCES_VALIDATED', 'remittance_batch', batch, jsonb_build_object('count', least(transfers, 999)));
  RETURN batch;
END
$$;

GRANT EXECUTE ON FUNCTION app.credit_notes(), app.save_credit_note_draft(uuid, uuid, credit_note_scope, jsonb, text, credit_note_follow_up),
  app.delete_credit_note_draft(uuid), app.issue_credit_note(uuid, credit_note_scope, jsonb, text, credit_note_follow_up, bigint, uuid),
  app.remittance_draft(date), app.remittance_batch(uuid) TO legarec_staff;
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM legarec_definer;

CALL app.secure('credit_note_refunds');
CALL app.secure('credit_note_drafts');
CREATE POLICY definer_all ON credit_note_refunds TO legarec_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON credit_note_drafts TO legarec_definer USING (true) WITH CHECK (true);
