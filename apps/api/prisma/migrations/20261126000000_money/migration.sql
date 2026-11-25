-- Money: interest rates, payments and their allocation, receipts, payment plans.
-- Cheque and transfer only, typed by hand: no card, no direct debit, no payment provider.

CREATE TYPE interest_rate_kind AS ENUM ('ECB', 'LEGAL_INDIVIDUAL');
CREATE TYPE payment_method AS ENUM ('CHEQUE', 'TRANSFER');
CREATE TYPE payment_status AS ENUM ('RECEIVED', 'DEPOSITED', 'CASHED', 'BOUNCED', 'RECONCILED', 'TO_RECONCILE');
CREATE TYPE allocation_component AS ENUM ('INTEREST', 'PRINCIPAL', 'FEES', 'OVERPAYMENT');
CREATE TYPE plan_status AS ENUM ('PENDING_MANAGER', 'WAITING_CREDITOR', 'WAITING_DEBTOR', 'ACTIVE', 'DONE', 'DEFAULT', 'REFUSED', 'CANCELLED');
CREATE TYPE plan_step AS ENUM ('COLLECTION_MANAGER', 'CREDITOR', 'DEBTOR');
CREATE TYPE plan_decision AS ENUM ('PENDING', 'APPROVED', 'REFUSED');
ALTER TYPE notification_kind ADD VALUE 'PLAN_DECIDED';

-- ---------------------------------------------------------------- Interest rates (question 75)

-- Published each semester: the ECB rate of its main refinancing operation (between professionals, plus 10 points), and the
-- legal rate for individuals. Valid from the first day of their semester until the next one.
CREATE TABLE interest_rates (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  kind interest_rate_kind NOT NULL,
  valid_from date NOT NULL CHECK (extract(day FROM valid_from) = 1 AND extract(month FROM valid_from) IN (1, 7)),
  rate_bp integer NOT NULL CHECK (rate_bp BETWEEN 0 AND 5000),
  entered_by uuid NOT NULL REFERENCES users (id),
  on_behalf_of_id uuid REFERENCES users (id),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  UNIQUE (kind, valid_from)
);

-- The day of the formal notice of an individual: interest runs from its delivery, failing that from its sending (question 98).
-- Written by the worker that sends the letter (lot Q).
ALTER TABLE cases ADD COLUMN formal_notice_on date;
GRANT SELECT (formal_notice_on) ON cases TO legarec_staff, legarec_worker;
GRANT UPDATE (formal_notice_on) ON cases TO legarec_worker;

-- A reference between two tables of a case carries the case too.
ALTER TABLE case_invoices ADD CONSTRAINT case_invoices_id_case UNIQUE (id, case_id);

-- ---------------------------------------------------------------- Payments

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  case_id uuid NOT NULL,
  creditor_id uuid NOT NULL,
  method payment_method NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents BETWEEN 1 AND 2000000000),
  status payment_status NOT NULL,
  received_on date NOT NULL,
  deposited_on date,
  settled_at timestamptz(3),
  bounced_at timestamptz(3),
  bounce_reason text CHECK (length(bounce_reason) <= 500),
  cheque_number text CHECK (cheque_number ~ '^[0-9]{7}$'),
  bank text CHECK (length(btrim(bank)) BETWEEN 2 AND 80),
  label text CHECK (length(btrim(label)) BETWEEN 1 AND 140),
  recorded_by uuid NOT NULL REFERENCES users (id),
  on_behalf_of_id uuid REFERENCES users (id),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  FOREIGN KEY (case_id, creditor_id) REFERENCES cases (id, creditor_id),
  UNIQUE (id, case_id),
  CONSTRAINT payments_cheque CHECK (
    CASE method
      WHEN 'CHEQUE' THEN cheque_number IS NOT NULL AND bank IS NOT NULL AND label IS NULL AND status IN ('RECEIVED', 'DEPOSITED', 'CASHED', 'BOUNCED')
      ELSE cheque_number IS NULL AND bank IS NULL AND deposited_on IS NULL AND label IS NOT NULL AND status IN ('TO_RECONCILE', 'RECONCILED')
    END),
  CONSTRAINT payments_bounced CHECK ((status = 'BOUNCED') = (bounced_at IS NOT NULL)),
  CONSTRAINT payments_settled CHECK ((status IN ('CASHED', 'RECONCILED')) = (settled_at IS NOT NULL)),
  CONSTRAINT payments_deposit CHECK (deposited_on IS NULL OR deposited_on >= received_on)
);
-- The same cheque is never recorded twice, unless it bounced and comes back.
CREATE UNIQUE INDEX payments_cheque_once ON payments (case_id, cheque_number, bank) WHERE method = 'CHEQUE' AND status <> 'BOUNCED';
CREATE INDEX payments_case ON payments (case_id, received_on);

-- Interest of the whole case first, then the principal from the oldest invoice to the most recent, then the indemnities;
-- what is left over is an overpayment. A bounced cheque is cancelled by opposite entries, never erased.
CREATE TABLE payment_allocations (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  case_id uuid NOT NULL,
  creditor_id uuid NOT NULL,
  payment_id uuid NOT NULL,
  invoice_id uuid,
  component allocation_component NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents <> 0 AND abs(amount_cents) <= 2000000000),
  reverses_id uuid,
  created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (case_id, creditor_id) REFERENCES cases (id, creditor_id),
  FOREIGN KEY (payment_id, case_id) REFERENCES payments (id, case_id),
  FOREIGN KEY (invoice_id, case_id) REFERENCES case_invoices (id, case_id),
  UNIQUE (id, payment_id),
  FOREIGN KEY (reverses_id, payment_id) REFERENCES payment_allocations (id, payment_id),
  CONSTRAINT payment_allocations_invoice CHECK ((component IN ('PRINCIPAL', 'FEES')) = (invoice_id IS NOT NULL)),
  CONSTRAINT payment_allocations_sign CHECK ((reverses_id IS NULL) = (amount_cents > 0))
);
CREATE UNIQUE INDEX payment_allocations_reversed_once ON payment_allocations (reverses_id) WHERE reverses_id IS NOT NULL;
CREATE INDEX payment_allocations_case ON payment_allocations (case_id);
CALL app.append_only('payment_allocations');

-- Numbered without any gap in the transaction that makes the payment final (Q-AAAA-NNNNN). The PDF comes with lot N.
CREATE TABLE receipts (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  case_id uuid NOT NULL,
  creditor_id uuid NOT NULL,
  payment_id uuid NOT NULL UNIQUE,
  number text NOT NULL UNIQUE CHECK (number ~ '^Q-[0-9]{4}-[0-9]{5}$'),
  document_id uuid,
  issued_at timestamptz(3) NOT NULL DEFAULT now(),
  FOREIGN KEY (case_id, creditor_id) REFERENCES cases (id, creditor_id),
  FOREIGN KEY (payment_id, case_id) REFERENCES payments (id, case_id)
);

-- ---------------------------------------------------------------- Payment plans

CREATE TABLE payment_plans (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  case_id uuid NOT NULL,
  creditor_id uuid NOT NULL,
  total_cents integer NOT NULL CHECK (total_cents BETWEEN 1 AND 2000000000),
  months integer NOT NULL CHECK (months BETWEEN 1 AND 60),
  method payment_method NOT NULL,
  first_due_on date NOT NULL,
  status plan_status NOT NULL,
  -- What was in force when it was asked: changing the setting afterwards changes nothing of it.
  threshold_months integer NOT NULL CHECK (threshold_months BETWEEN 1 AND 60),
  owned_by_director boolean NOT NULL,
  requested_by uuid NOT NULL REFERENCES users (id),
  on_behalf_of_id uuid REFERENCES users (id),
  -- « Accepter cet échéancier » in the space of the debtor (lot O): date, address, fingerprint of the PDF.
  accepted_at timestamptz(3),
  accepted_ip inet,
  document_id uuid,
  document_sha256 text CHECK (document_sha256 ~ '^[0-9a-f]{64}$'),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  FOREIGN KEY (case_id, creditor_id) REFERENCES cases (id, creditor_id),
  UNIQUE (id, case_id)
);
-- One plan in progress per case.
CREATE UNIQUE INDEX payment_plans_one_open ON payment_plans (case_id) WHERE status IN ('PENDING_MANAGER', 'WAITING_CREDITOR', 'WAITING_DEBTOR', 'ACTIVE');
CREATE INDEX payment_plans_status ON payment_plans (status);

CREATE TABLE plan_approvals (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  case_id uuid NOT NULL,
  creditor_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  step plan_step NOT NULL,
  decision plan_decision NOT NULL DEFAULT 'PENDING',
  decided_by uuid REFERENCES users (id),
  reason text CHECK (length(reason) <= 500),
  on_behalf_of_id uuid REFERENCES users (id),
  decided_at timestamptz(3),
  FOREIGN KEY (case_id, creditor_id) REFERENCES cases (id, creditor_id),
  FOREIGN KEY (plan_id, case_id) REFERENCES payment_plans (id, case_id),
  UNIQUE (plan_id, step),
  CONSTRAINT plan_approvals_decided CHECK ((decision = 'PENDING') = (decided_at IS NULL)),
  CONSTRAINT plan_approvals_team CHECK (step <> 'COLLECTION_MANAGER' OR (decision = 'PENDING') = (decided_by IS NULL))
);

-- What each installment is paid is computed from the payments of the case: a bounced cheque changes it without any entry here.
CREATE TABLE installments (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  case_id uuid NOT NULL,
  creditor_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  number integer NOT NULL CHECK (number BETWEEN 1 AND 60),
  due_on date NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents BETWEEN 1 AND 2000000000),
  FOREIGN KEY (case_id, creditor_id) REFERENCES cases (id, creditor_id),
  FOREIGN KEY (plan_id, case_id) REFERENCES payment_plans (id, case_id),
  UNIQUE (plan_id, number)
);
CREATE INDEX installments_due ON installments (due_on);

-- Notifications: the plan decided, with its case and the decision.
ALTER TABLE notifications
  ADD COLUMN plan_id uuid,
  ADD COLUMN plan_decision plan_decision,
  DROP CONSTRAINT notifications_case,
  ADD CONSTRAINT notifications_case CHECK (case_id IS NULL OR (creditor_id IS NOT NULL AND kind::text IN ('CASE_ASSIGNED', 'PLAN_DECIDED'))),
  ADD CONSTRAINT notifications_plan CHECK (
    (plan_id IS NOT NULL) = (kind::text = 'PLAN_DECIDED') AND (plan_id IS NULL OR case_id IS NOT NULL)
    AND (plan_decision IS NOT NULL) = (plan_id IS NOT NULL) AND plan_decision IS DISTINCT FROM 'PENDING');
ALTER TABLE notifications ADD FOREIGN KEY (plan_id, case_id) REFERENCES payment_plans (id, case_id);
GRANT SELECT (plan_id, plan_decision) ON notifications TO legarec_staff;

-- ---------------------------------------------------------------- Functions
-- The team writes nothing of the money directly: each change goes through a function below, which checks again who acts,
-- from which state, and what it adds up to. The interest of a payment is computed by the API (rates, days, rounding);
-- everything else is checked here.

GRANT CREATE ON SCHEMA app TO legarec_definer;
GRANT SELECT (id, case_id, number, due_on, principal_cents, principal_paid_cents, state), UPDATE (principal_paid_cents, state) ON case_invoices TO legarec_definer;
GRANT SELECT (id, case_id, creditor_id, method, amount_cents, status, received_on, version),
  INSERT (id, case_id, creditor_id, method, amount_cents, status, received_on, deposited_on, settled_at, cheque_number, bank, label, recorded_by, on_behalf_of_id),
  UPDATE (status, settled_at, bounced_at, bounce_reason, version) ON payments TO legarec_definer;
GRANT SELECT (id, case_id, creditor_id, payment_id, invoice_id, component, amount_cents, reverses_id),
  INSERT (case_id, creditor_id, payment_id, invoice_id, component, amount_cents, reverses_id) ON payment_allocations TO legarec_definer;
GRANT SELECT (id, payment_id, document_id), INSERT (case_id, creditor_id, payment_id, number) ON receipts TO legarec_definer;
GRANT SELECT (kind, valid_from, rate_bp, entered_by, on_behalf_of_id), INSERT (kind, valid_from, rate_bp, entered_by, on_behalf_of_id), UPDATE (rate_bp, entered_by, on_behalf_of_id, updated_at) ON interest_rates TO legarec_definer;
GRANT SELECT (id, case_id, creditor_id, months, status, requested_by, version),
  INSERT (id, case_id, creditor_id, total_cents, months, method, first_due_on, status, threshold_months, owned_by_director, requested_by, on_behalf_of_id),
  UPDATE (status, version) ON payment_plans TO legarec_definer;
GRANT SELECT (id, plan_id, step, decision), INSERT (case_id, creditor_id, plan_id, step), UPDATE (decision, decided_by, reason, on_behalf_of_id, decided_at) ON plan_approvals TO legarec_definer;
GRANT INSERT (case_id, creditor_id, plan_id, number, due_on, amount_cents) ON installments TO legarec_definer;
GRANT INSERT (plan_id, plan_decision) ON notifications TO legarec_definer;
GRANT SELECT (id, creditor_id, debtor_id, officer_id, mandate_id, status), UPDATE (status, closed_on) ON cases TO legarec_definer;
GRANT SELECT (id, kind) ON debtors TO legarec_definer;
GRANT SELECT (id, creditor_id, fixed_indemnity) ON mandates TO legarec_definer;
SET LOCAL ROLE legarec_definer;

-- What is paid of each invoice follows its allocations: nobody writes it by hand.
CREATE FUNCTION app.follow_allocation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.component = 'PRINCIPAL' THEN
    UPDATE public.case_invoices i SET
      principal_paid_cents = i.principal_paid_cents + NEW.amount_cents,
      state = CASE
        WHEN i.principal_paid_cents + NEW.amount_cents = i.principal_cents THEN 'PAID'::invoice_state
        WHEN i.state IN ('UNPAID', 'PARTIAL', 'PAID') THEN CASE WHEN i.principal_paid_cents + NEW.amount_cents > 0 THEN 'PARTIAL'::invoice_state ELSE 'UNPAID'::invoice_state END
        ELSE i.state
      END
    WHERE i.id = NEW.invoice_id AND i.case_id = NEW.case_id;
  END IF;
  RETURN NULL;
END
$$;

-- At the end of the transaction: what a payment is allocated to adds up to it; a bounced payment is cancelled entirely, and
-- only a bounced one.
CREATE FUNCTION app.check_allocations() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  target uuid;
  paid record;
  allocated bigint;
  left_over bigint;
BEGIN
  IF TG_TABLE_NAME = 'payments' THEN
    target := NEW.id;
  ELSE
    target := NEW.payment_id;
  END IF;
  SELECT p.amount_cents, p.status INTO paid FROM public.payments p WHERE p.id = target;
  SELECT coalesce(sum(a.amount_cents) FILTER (WHERE a.reverses_id IS NULL), 0), coalesce(sum(a.amount_cents), 0)
  INTO allocated, left_over FROM public.payment_allocations a WHERE a.payment_id = target;
  IF allocated <> paid.amount_cents OR left_over <> (CASE WHEN paid.status = 'BOUNCED' THEN 0 ELSE paid.amount_cents END) THEN
    RAISE EXCEPTION 'allocations of a payment do not add up' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;

-- A receipt never changes, but for the PDF that the worker attaches to it once (lot N).
CREATE FUNCTION app.keep_receipt() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP <> 'UPDATE' OR OLD.document_id IS NOT NULL OR NEW.document_id IS NULL
    OR (NEW.id, NEW.case_id, NEW.creditor_id, NEW.payment_id, NEW.number, NEW.issued_at) IS DISTINCT FROM (OLD.id, OLD.case_id, OLD.creditor_id, OLD.payment_id, OLD.number, OLD.issued_at) THEN
    RAISE EXCEPTION 'a receipt never changes' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;

-- The case, for whoever acts on it; one change of money at a time per case.
CREATE FUNCTION app.money_case(target uuid, OUT creditor_id uuid, OUT debtor_id uuid, OUT officer_id uuid, OUT mandate_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'STAFF' OR app.staff_role() IS NULL OR app.staff_role() = 'DEVELOPER' THEN
    PERFORM app.refuse('42501');
  END IF;
  SELECT c.creditor_id, c.debtor_id, c.officer_id, c.mandate_id INTO creditor_id, debtor_id, officer_id, mandate_id
  FROM public.cases c WHERE c.id = target AND app.can_act_on_case(c.officer_id);
  IF NOT FOUND THEN
    PERFORM app.refuse('42501');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('money:' || target::text, 0));
END
$$;

CREATE FUNCTION app.issue_receipt(paid uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  next record;
BEGIN
  SELECT * INTO next FROM app.next_number('RECEIPT');
  INSERT INTO public.receipts (case_id, creditor_id, payment_id, number)
  SELECT p.case_id, p.creditor_id, p.id, format('Q-%s-%s', next.for_year, lpad(next.number::text, 5, '0'))
  FROM public.payments p WHERE p.id = paid AND p.status IN ('CASHED', 'RECONCILED');
  IF NOT FOUND THEN
    PERFORM app.refuse('LG409');
  END IF;
END
$$;

-- Records a payment and its allocation. `parts`: [{component, invoice, amount}], computed by the API; checked here: every
-- cent goes somewhere, the principal from the oldest invoice, the 40 € only between professionals and when the mandate
-- claims them, nothing over before everything else is paid. Never in the future, never already cashed.
CREATE FUNCTION app.record_payment(target uuid, wanted payment_method, amount integer, received date, deposited date, cheque text, bank_name text, label_text text,
  reconciled boolean, parts jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  held record;
  paid uuid := app.uuid_v7();
  today date := (now() AT TIME ZONE 'Europe/Paris')::date;
  claims_fees boolean;
BEGIN
  SELECT * INTO held FROM app.money_case(target);
  IF received > today OR (deposited IS NOT NULL AND (wanted <> 'CHEQUE' OR deposited < received OR deposited > today)) OR jsonb_typeof(parts) <> 'array' THEN
    PERFORM app.refuse('22023');
  END IF;
  INSERT INTO public.payments (id, case_id, creditor_id, method, amount_cents, status, received_on, deposited_on, settled_at, cheque_number, bank, label, recorded_by, on_behalf_of_id)
  VALUES (paid, target, held.creditor_id, wanted, amount,
    CASE WHEN wanted = 'CHEQUE' THEN CASE WHEN deposited IS NULL THEN 'RECEIVED' ELSE 'DEPOSITED' END WHEN reconciled THEN 'RECONCILED' ELSE 'TO_RECONCILE' END::payment_status,
    received, deposited, CASE WHEN wanted = 'TRANSFER' AND reconciled THEN now() END,
    CASE WHEN wanted = 'CHEQUE' THEN cheque END, CASE WHEN wanted = 'CHEQUE' THEN btrim(bank_name) END, CASE WHEN wanted = 'TRANSFER' THEN btrim(label_text) END,
    app.user_id(), app.on_behalf_of());
  INSERT INTO public.payment_allocations (case_id, creditor_id, payment_id, invoice_id, component, amount_cents)
  SELECT target, held.creditor_id, paid, (part ->> 'invoice')::uuid, (part ->> 'component')::allocation_component, (part ->> 'amount')::integer
  FROM jsonb_array_elements(parts) AS part;
  -- Principal: never on an invoice while an older one is still owed.
  IF EXISTS (
    SELECT 1 FROM public.payment_allocations a JOIN public.case_invoices i ON i.id = a.invoice_id
    JOIN public.case_invoices older ON older.case_id = target AND (older.due_on, older.number COLLATE "C") < (i.due_on, i.number COLLATE "C")
    WHERE a.payment_id = paid AND a.component = 'PRINCIPAL' AND older.principal_paid_cents < older.principal_cents
  ) THEN
    PERFORM app.refuse('22023');
  END IF;
  -- Indemnities: 40 € per invoice past due on the day, between professionals, if the mandate claims it; after the principal.
  SELECT d.kind <> 'INDIVIDUAL' AND coalesce(m.fixed_indemnity, false) INTO claims_fees
  FROM public.debtors d LEFT JOIN public.mandates m ON m.id = held.mandate_id AND m.creditor_id = held.creditor_id WHERE d.id = held.debtor_id;
  IF EXISTS (SELECT 1 FROM public.payment_allocations a WHERE a.payment_id = paid AND a.component IN ('FEES', 'OVERPAYMENT'))
    AND EXISTS (SELECT 1 FROM public.case_invoices i WHERE i.case_id = target AND i.principal_paid_cents < i.principal_cents) THEN
    PERFORM app.refuse('22023');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.case_invoices i
    WHERE i.case_id = target AND coalesce((
      SELECT sum(a.amount_cents) FROM public.payment_allocations a JOIN public.payments p ON p.id = a.payment_id
      WHERE a.invoice_id = i.id AND a.component = 'FEES' AND p.status <> 'BOUNCED'), 0) > (CASE WHEN claims_fees AND i.due_on < received THEN 4000 ELSE 0 END)
  ) THEN
    PERFORM app.refuse('22023');
  END IF;
  -- Over: only once every indemnity due is paid.
  IF EXISTS (SELECT 1 FROM public.payment_allocations a WHERE a.payment_id = paid AND a.component = 'OVERPAYMENT') AND claims_fees AND EXISTS (
    SELECT 1 FROM public.case_invoices i
    WHERE i.case_id = target AND i.due_on < received AND coalesce((
      SELECT sum(a.amount_cents) FROM public.payment_allocations a JOIN public.payments p ON p.id = a.payment_id
      WHERE a.invoice_id = i.id AND a.component = 'FEES' AND p.status <> 'BOUNCED'), 0) < 4000
  ) THEN
    PERFORM app.refuse('22023');
  END IF;
  IF wanted = 'TRANSFER' AND reconciled THEN
    PERFORM app.issue_receipt(paid);
  END IF;
  PERFORM app.add_case_event(target, 'PAYMENT_RECORDED', 'Paiement enregistré', CASE WHEN wanted = 'CHEQUE' THEN 'Chèque' ELSE 'Virement' END, 'success', true);
  PERFORM app.log('PAYMENT_RECORDED', 'case', target, '{}');
  RETURN paid;
END
$$;

-- Cashed, reconciled or bounced, from the state and the version the screen showed. A bounced cheque is cancelled by opposite
-- entries, and reopens a settled case; a final payment gets its receipt.
CREATE FUNCTION app.change_payment(target uuid, paid uuid, wanted payment_status, why text, expected_version integer) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  held record;
  payment record;
  allowed boolean;
BEGIN
  SELECT * INTO held FROM app.money_case(target);
  SELECT p.id, p.method, p.status, p.version INTO payment FROM public.payments p WHERE p.id = paid AND p.case_id = target FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app.refuse('LG404');
  END IF;
  allowed := CASE payment.method
    WHEN 'CHEQUE' THEN payment.status IN ('RECEIVED', 'DEPOSITED') AND wanted IN ('CASHED', 'BOUNCED')
    ELSE payment.status = 'TO_RECONCILE' AND wanted = 'RECONCILED'
  END;
  IF payment.version <> expected_version OR NOT allowed THEN
    PERFORM app.refuse('LG409');
  END IF;
  IF wanted = 'BOUNCED' THEN
    UPDATE public.payments p SET status = 'BOUNCED', bounced_at = now(), bounce_reason = nullif(btrim(why), ''), version = p.version + 1 WHERE p.id = paid;
    INSERT INTO public.payment_allocations (case_id, creditor_id, payment_id, invoice_id, component, amount_cents, reverses_id)
    SELECT a.case_id, a.creditor_id, a.payment_id, a.invoice_id, a.component, -a.amount_cents, a.id
    FROM public.payment_allocations a WHERE a.payment_id = paid AND a.reverses_id IS NULL;
    UPDATE public.cases c SET status = 'OVERDUE', closed_on = NULL WHERE c.id = target AND c.status = 'SETTLED';
    PERFORM app.add_case_event(target, 'PAYMENT_BOUNCED', 'Chèque impayé', NULL, 'danger', true);
    PERFORM app.log('PAYMENT_BOUNCED', 'case', target, '{}');
  ELSE
    UPDATE public.payments p SET status = wanted, settled_at = now(), version = p.version + 1 WHERE p.id = paid;
    PERFORM app.issue_receipt(paid);
    PERFORM app.add_case_event(target, 'PAYMENT_SETTLED', 'Paiement définitif, quittance générée', NULL, 'success', true);
    PERFORM app.log('PAYMENT_SETTLED', 'case', target, '{}');
  END IF;
END
$$;

-- The rate of a semester, typed by the Director or the manager on their behalf (FIRM), from the value the screen showed
-- (null: none yet); corrected the same way.
CREATE FUNCTION app.save_interest_rate(wanted interest_rate_kind, semester date, bp integer, expected integer) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NOT app.acts_as_director('ADMINISTRATIVE') THEN
    PERFORM app.refuse('42501');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('rate:' || wanted::text || semester::text, 0));
  IF (SELECT r.rate_bp FROM public.interest_rates r WHERE r.kind = wanted AND r.valid_from = semester) IS DISTINCT FROM expected THEN
    PERFORM app.refuse('LG409');
  END IF;
  INSERT INTO public.interest_rates AS r (kind, valid_from, rate_bp, entered_by, on_behalf_of_id)
  VALUES (wanted, semester, bp, app.user_id(), app.on_behalf_of())
  ON CONFLICT (kind, valid_from) DO UPDATE SET rate_bp = EXCLUDED.rate_bp, entered_by = EXCLUDED.entered_by, on_behalf_of_id = EXCLUDED.on_behalf_of_id, updated_at = now();
END
$$;

-- Asks for a plan. Who must approve it is decided here, from the setting in force and the holder of the case (question 86):
-- above the threshold, the manager then the creditor, or the creditor alone on a case of the Director; then the debtor.
CREATE FUNCTION app.ask_plan(target uuid, wanted payment_method, total integer, amounts integer[], dates date[]) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  held record;
  plan uuid := app.uuid_v7();
  months integer := cardinality(amounts);
  threshold integer;
  of_director boolean;
  steps plan_step[];
BEGIN
  SELECT * INTO held FROM app.money_case(target);
  IF months NOT BETWEEN 1 AND 60 OR cardinality(dates) <> months OR (SELECT sum(x) FROM unnest(amounts) x) <> total OR EXISTS (SELECT 1 FROM unnest(amounts) x WHERE x <= 0)
    OR dates[1] <= (now() AT TIME ZONE 'Europe/Paris')::date
    OR EXISTS (SELECT 1 FROM generate_subscripts(dates, 1) n WHERE n > 1 AND dates[n] <= dates[n - 1]) THEN
    PERFORM app.refuse('22023');
  END IF;
  threshold := coalesce((SELECT substring(s.value #>> '{}' FROM '^[0-9]{1,2}')::integer FROM public.settings s WHERE s.key = 'firm.regles.duration'), 6);
  of_director := held.officer_id IS NOT NULL AND held.officer_id = app.director_id();
  steps := CASE WHEN months <= threshold THEN '{}'::plan_step[] WHEN of_director THEN '{CREDITOR}'::plan_step[] ELSE '{COLLECTION_MANAGER,CREDITOR}'::plan_step[] END;
  INSERT INTO public.payment_plans (id, case_id, creditor_id, total_cents, months, method, first_due_on, status, threshold_months, owned_by_director, requested_by, on_behalf_of_id)
  VALUES (plan, target, held.creditor_id, total, months, wanted, dates[1],
    CASE coalesce(steps[1]::text, '') WHEN 'COLLECTION_MANAGER' THEN 'PENDING_MANAGER' WHEN 'CREDITOR' THEN 'WAITING_CREDITOR' ELSE 'WAITING_DEBTOR' END::plan_status,
    threshold, of_director, app.user_id(), app.on_behalf_of());
  INSERT INTO public.plan_approvals (case_id, creditor_id, plan_id, step) SELECT target, held.creditor_id, plan, step FROM unnest(steps || 'DEBTOR'::plan_step) AS step;
  INSERT INTO public.installments (case_id, creditor_id, plan_id, number, due_on, amount_cents)
  SELECT target, held.creditor_id, plan, n, dates[n], amounts[n] FROM generate_subscripts(amounts, 1) n;
  PERFORM app.add_case_event(target, 'PLAN_ASKED', 'Échéancier proposé', months || ' mensualités', 'info', true);
  PERFORM app.log('PLAN_ASKED', 'case', target, jsonb_build_object('count', least(months, 999)));
  RETURN plan;
END
$$;

-- The manager validates a long plan (question 86), on the cases they act on. Told to whoever asked for it, if someone else.
CREATE FUNCTION app.decide_plan(target uuid, wanted plan_decision, why text, expected_version integer) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  plan record;
BEGIN
  IF app.staff_role() IS DISTINCT FROM 'COLLECTION_MANAGER' OR wanted = 'PENDING' THEN
    PERFORM app.refuse('42501');
  END IF;
  SELECT p.id, p.case_id, p.creditor_id, p.months, p.status, p.requested_by, p.version INTO plan
  FROM public.payment_plans p JOIN public.cases c ON c.id = p.case_id
  WHERE p.id = target AND app.can_act_on_case(c.officer_id)
  FOR UPDATE OF p;
  IF NOT FOUND THEN
    PERFORM app.refuse('LG404');
  END IF;
  IF plan.status <> 'PENDING_MANAGER' OR plan.version <> expected_version THEN
    PERFORM app.refuse('LG409');
  END IF;
  UPDATE public.plan_approvals a SET decision = wanted, decided_by = app.user_id(), reason = nullif(btrim(why), ''), on_behalf_of_id = app.on_behalf_of(), decided_at = now()
  WHERE a.plan_id = target AND a.step = 'COLLECTION_MANAGER' AND a.decision = 'PENDING';
  IF NOT FOUND THEN
    PERFORM app.refuse('LG409');
  END IF;
  UPDATE public.payment_plans p SET status = CASE WHEN wanted = 'APPROVED' THEN 'WAITING_CREDITOR'::plan_status ELSE 'REFUSED'::plan_status END, version = p.version + 1
  WHERE p.id = target;
  PERFORM app.add_case_event(plan.case_id, 'PLAN_DECIDED', CASE WHEN wanted = 'APPROVED' THEN 'Échéancier validé par le Responsable' ELSE 'Échéancier refusé par le Responsable' END,
    NULL, CASE WHEN wanted = 'APPROVED' THEN 'success'::event_tone ELSE 'warning'::event_tone END, false);
  PERFORM app.log(CASE WHEN wanted = 'APPROVED' THEN 'PLAN_APPROVED' ELSE 'PLAN_REFUSED' END, 'case', plan.case_id, jsonb_build_object('months', least(plan.months, 999)));
  IF plan.requested_by <> app.user_id() THEN
    INSERT INTO public.notifications (user_id, kind, actor_id, target_id, plan_id, plan_decision, case_id, creditor_id, case_count)
    VALUES (plan.requested_by, 'PLAN_DECIDED', app.user_id(), plan.requested_by, target, wanted, plan.case_id, plan.creditor_id, 1);
  END IF;
END
$$;
-- The owner of the tables attaches the triggers.
GRANT EXECUTE ON FUNCTION app.follow_allocation(), app.check_allocations(), app.keep_receipt() TO legarec_owner;
GRANT EXECUTE ON FUNCTION app.save_interest_rate(interest_rate_kind, date, integer, integer), app.decide_plan(uuid, plan_decision, text, integer),
  app.record_payment(uuid, payment_method, integer, date, date, text, text, text, boolean, jsonb), app.change_payment(uuid, uuid, payment_status, text, integer),
  app.ask_plan(uuid, payment_method, integer, integer[], date[]) TO legarec_staff;
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM legarec_definer;

CREATE TRIGGER follow_allocation AFTER INSERT ON payment_allocations FOR EACH ROW EXECUTE FUNCTION app.follow_allocation();
CREATE CONSTRAINT TRIGGER allocations_add_up AFTER INSERT ON payment_allocations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.check_allocations();
CREATE CONSTRAINT TRIGGER payment_allocated AFTER INSERT OR UPDATE ON payments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.check_allocations();
CREATE TRIGGER keep_receipt BEFORE UPDATE OR DELETE ON receipts FOR EACH ROW EXECUTE FUNCTION app.keep_receipt();
CREATE TRIGGER refuse_truncate BEFORE TRUNCATE ON receipts FOR EACH STATEMENT EXECUTE FUNCTION app.refuse_change();

-- ---------------------------------------------------------------- Policies and rights
-- The team reads; it writes by the functions above only.

CALL app.secure('interest_rates');
CREATE POLICY definer_all ON interest_rates TO legarec_definer USING (true) WITH CHECK (true);
CREATE POLICY staff_read ON interest_rates FOR SELECT TO legarec_staff USING ((SELECT app.staff_role()) IS NOT NULL);
CREATE POLICY worker_read ON interest_rates FOR SELECT TO legarec_worker USING (true);
GRANT SELECT (id, kind, valid_from, rate_bp, entered_by, on_behalf_of_id, updated_at) ON interest_rates TO legarec_staff;
GRANT SELECT (kind, valid_from, rate_bp) ON interest_rates TO legarec_worker;

-- Payments: a creditor reads the date, the amount and the means, a debtor their own.
CALL app.secure_case_table('payments', ARRAY['partner', 'debtor']);
CREATE POLICY definer_all ON payments TO legarec_definer USING (true) WITH CHECK (true);
GRANT SELECT (id, case_id, creditor_id, method, amount_cents, status, received_on, deposited_on, settled_at, bounced_at, bounce_reason, cheque_number, bank, label,
  recorded_by, on_behalf_of_id, version, created_at) ON payments TO legarec_staff;
GRANT SELECT (id, case_id, creditor_id, method, amount_cents, status, received_on, deposited_on, settled_at, bounced_at) ON payments TO legarec_worker;
GRANT SELECT (id, case_id, creditor_id, method, amount_cents, status, received_on) ON payments TO legarec_partner, legarec_debtor;

CALL app.secure_case_table('payment_allocations', ARRAY['partner', 'debtor']);
CREATE POLICY definer_all ON payment_allocations TO legarec_definer USING (true) WITH CHECK (true);
GRANT SELECT (id, case_id, creditor_id, payment_id, invoice_id, component, amount_cents, reverses_id, created_at) ON payment_allocations TO legarec_staff;
GRANT SELECT (id, case_id, creditor_id, payment_id, invoice_id, component, amount_cents, reverses_id) ON payment_allocations TO legarec_worker, legarec_partner, legarec_debtor;
CREATE POLICY definer_follow ON case_invoices FOR UPDATE TO legarec_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_read ON case_invoices FOR SELECT TO legarec_definer USING (true);
CREATE POLICY definer_money ON mandates FOR SELECT TO legarec_definer USING (true);

CALL app.secure_case_table('receipts', ARRAY['debtor']);
CREATE POLICY definer_all ON receipts TO legarec_definer USING (true) WITH CHECK (true);
GRANT SELECT (id, case_id, creditor_id, payment_id, number, document_id, issued_at) ON receipts TO legarec_staff;
GRANT SELECT (id, case_id, creditor_id, payment_id, number, document_id, issued_at), UPDATE (document_id) ON receipts TO legarec_worker;
GRANT SELECT (id, case_id, creditor_id, payment_id, number, issued_at) ON receipts TO legarec_debtor;

-- Plans: a creditor reads them once they come to it, a debtor once they are proposed to it.
CALL app.secure_case_table('payment_plans', ARRAY['partner', 'debtor']);
CREATE POLICY definer_all ON payment_plans TO legarec_definer USING (true) WITH CHECK (true);
CREATE POLICY partner_shown ON payment_plans AS RESTRICTIVE FOR SELECT TO legarec_partner USING (status IN ('WAITING_CREDITOR', 'WAITING_DEBTOR', 'ACTIVE', 'DONE', 'DEFAULT'));
CREATE POLICY debtor_shown ON payment_plans AS RESTRICTIVE FOR SELECT TO legarec_debtor USING (status IN ('WAITING_DEBTOR', 'ACTIVE', 'DONE', 'DEFAULT'));
GRANT SELECT (id, case_id, creditor_id, total_cents, months, method, first_due_on, status, threshold_months, owned_by_director, requested_by, on_behalf_of_id,
  accepted_at, document_id, version, created_at) ON payment_plans TO legarec_staff;
GRANT SELECT (id, case_id, creditor_id, total_cents, months, method, first_due_on, status, accepted_at, version) ON payment_plans TO legarec_worker;
GRANT SELECT (id, case_id, creditor_id, total_cents, months, method, first_due_on, status, accepted_at) ON payment_plans TO legarec_partner, legarec_debtor;

CALL app.secure_case_table('plan_approvals', ARRAY['partner']);
CREATE POLICY definer_all ON plan_approvals TO legarec_definer USING (true) WITH CHECK (true);
CREATE POLICY partner_step ON plan_approvals AS RESTRICTIVE FOR SELECT TO legarec_partner USING (step = 'CREDITOR' AND plan_id IN (SELECT p.id FROM public.payment_plans p));
GRANT SELECT (id, case_id, creditor_id, plan_id, step, decision, decided_by, reason, on_behalf_of_id, decided_at) ON plan_approvals TO legarec_staff;
GRANT SELECT (id, case_id, creditor_id, plan_id, step, decision, decided_at) ON plan_approvals TO legarec_worker, legarec_partner;

CALL app.secure_case_table('installments', ARRAY['partner', 'debtor']);
CREATE POLICY definer_all ON installments TO legarec_definer USING (true) WITH CHECK (true);
-- Those of a plan the creditor or the debtor is shown.
CREATE POLICY outside_shown ON installments AS RESTRICTIVE FOR SELECT TO legarec_partner, legarec_debtor USING (plan_id IN (SELECT p.id FROM public.payment_plans p));
GRANT SELECT (id, case_id, creditor_id, plan_id, number, due_on, amount_cents) ON installments TO legarec_staff, legarec_worker, legarec_partner, legarec_debtor;
