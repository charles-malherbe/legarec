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

-- Notifications: the plan decided, with its case.
ALTER TABLE notifications
  ADD COLUMN plan_id uuid,
  DROP CONSTRAINT notifications_case,
  ADD CONSTRAINT notifications_case CHECK (case_id IS NULL OR (creditor_id IS NOT NULL AND kind::text IN ('CASE_ASSIGNED', 'PLAN_DECIDED'))),
  ADD CONSTRAINT notifications_plan CHECK ((plan_id IS NOT NULL) = (kind::text = 'PLAN_DECIDED') AND (plan_id IS NULL OR case_id IS NOT NULL));
ALTER TABLE notifications ADD FOREIGN KEY (plan_id, case_id) REFERENCES payment_plans (id, case_id);
GRANT SELECT (plan_id) ON notifications TO legarec_staff;

-- ---------------------------------------------------------------- Functions

GRANT CREATE ON SCHEMA app TO legarec_definer;
GRANT SELECT (id, case_id, principal_cents, principal_paid_cents, state), UPDATE (principal_paid_cents, state) ON case_invoices TO legarec_definer;
GRANT SELECT (id, case_id, amount_cents) ON payments TO legarec_definer;
GRANT SELECT (payment_id, invoice_id, component, amount_cents, reverses_id) ON payment_allocations TO legarec_definer;
GRANT SELECT (kind, valid_from, rate_bp, entered_by, on_behalf_of_id), INSERT (kind, valid_from, rate_bp, entered_by, on_behalf_of_id), UPDATE (rate_bp, entered_by, on_behalf_of_id, updated_at) ON interest_rates TO legarec_definer;
GRANT SELECT (id, case_id, creditor_id, status, requested_by, version), UPDATE (status, version) ON payment_plans TO legarec_definer;
GRANT SELECT (id, plan_id, step, decision), UPDATE (decision, decided_by, reason, on_behalf_of_id, decided_at) ON plan_approvals TO legarec_definer;
GRANT INSERT (plan_id, case_id, creditor_id) ON notifications TO legarec_definer;
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

-- At the end of the transaction: what a payment is allocated to adds up to it, and a cancellation cancels all of it.
CREATE FUNCTION app.check_allocations() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  target uuid;
  amount integer;
  allocated bigint;
  left_over bigint;
BEGIN
  IF TG_TABLE_NAME = 'payments' THEN
    target := NEW.id;
  ELSE
    target := NEW.payment_id;
  END IF;
  SELECT p.amount_cents INTO amount FROM public.payments p WHERE p.id = target;
  SELECT coalesce(sum(a.amount_cents) FILTER (WHERE a.reverses_id IS NULL), 0), coalesce(sum(a.amount_cents), 0)
  INTO allocated, left_over FROM public.payment_allocations a WHERE a.payment_id = target;
  IF allocated <> amount OR left_over NOT IN (0, amount) THEN
    RAISE EXCEPTION 'allocations of a payment do not add up' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;

-- The rate of a semester, typed by the Director or the manager on their behalf (FIRM); corrected the same way.
CREATE FUNCTION app.save_interest_rate(wanted interest_rate_kind, semester date, bp integer) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NOT app.acts_as_director('ADMINISTRATIVE') THEN
    PERFORM app.refuse('42501');
  END IF;
  INSERT INTO public.interest_rates AS r (kind, valid_from, rate_bp, entered_by, on_behalf_of_id)
  VALUES (wanted, semester, bp, app.user_id(), app.on_behalf_of())
  ON CONFLICT (kind, valid_from) DO UPDATE SET rate_bp = EXCLUDED.rate_bp, entered_by = EXCLUDED.entered_by, on_behalf_of_id = EXCLUDED.on_behalf_of_id, updated_at = now();
END
$$;

-- The manager validates a long plan (question 86), on the cases they act on; the Director validates those of their own cases by
-- asking for them. Then the creditor agrees (lot P). Told to whoever asked for it, if it is someone else.
CREATE FUNCTION app.decide_plan(target uuid, wanted plan_decision, why text, expected_version integer) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  plan record;
BEGIN
  IF app.staff_role() IS DISTINCT FROM 'COLLECTION_MANAGER' OR wanted = 'PENDING' THEN
    PERFORM app.refuse('42501');
  END IF;
  SELECT p.id, p.case_id, p.creditor_id, p.status, p.requested_by, p.version INTO plan
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
  IF plan.requested_by <> app.user_id() THEN
    INSERT INTO public.notifications (user_id, kind, actor_id, target_id, plan_id, case_id, creditor_id, case_count)
    VALUES (plan.requested_by, 'PLAN_DECIDED', app.user_id(), plan.requested_by, target, plan.case_id, plan.creditor_id, 1);
  END IF;
END
$$;
-- The owner of the tables attaches the triggers.
GRANT EXECUTE ON FUNCTION app.follow_allocation(), app.check_allocations() TO legarec_owner;
GRANT EXECUTE ON FUNCTION app.save_interest_rate(interest_rate_kind, date, integer), app.decide_plan(uuid, plan_decision, text, integer) TO legarec_staff;
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM legarec_definer;

CREATE TRIGGER follow_allocation AFTER INSERT ON payment_allocations FOR EACH ROW EXECUTE FUNCTION app.follow_allocation();
CREATE CONSTRAINT TRIGGER allocations_add_up AFTER INSERT ON payment_allocations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.check_allocations();
CREATE CONSTRAINT TRIGGER payment_allocated AFTER INSERT ON payments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.check_allocations();


-- ---------------------------------------------------------------- Policies and rights

CALL app.secure('interest_rates');
CREATE POLICY definer_all ON interest_rates TO legarec_definer USING (true) WITH CHECK (true);
CREATE POLICY staff_read ON interest_rates FOR SELECT TO legarec_staff USING ((SELECT app.staff_role()) IS NOT NULL);
CREATE POLICY worker_read ON interest_rates FOR SELECT TO legarec_worker USING (true);
GRANT SELECT (id, kind, valid_from, rate_bp, entered_by, on_behalf_of_id, updated_at) ON interest_rates TO legarec_staff;
GRANT SELECT (kind, valid_from, rate_bp) ON interest_rates TO legarec_worker;

-- Payments: whoever acts on the case records them, in their own name; a creditor reads the date, the amount and the means,
-- a debtor their own.
CALL app.secure_case_table('payments', ARRAY['partner', 'debtor']);
CREATE POLICY staff_typed ON payments AS RESTRICTIVE FOR INSERT TO legarec_staff
  WITH CHECK (recorded_by = (SELECT app.user_id()) AND on_behalf_of_id IS NOT DISTINCT FROM (SELECT app.on_behalf_of()) AND bounced_at IS NULL AND version = 1);
CREATE POLICY definer_read ON payments FOR SELECT TO legarec_definer USING (true);
GRANT SELECT (id, case_id, creditor_id, method, amount_cents, status, received_on, deposited_on, settled_at, bounced_at, bounce_reason, cheque_number, bank, label,
  recorded_by, on_behalf_of_id, version, created_at),
  INSERT (id, case_id, creditor_id, method, amount_cents, status, received_on, deposited_on, settled_at, cheque_number, bank, label, recorded_by, on_behalf_of_id, version),
  UPDATE (status, deposited_on, settled_at, bounced_at, bounce_reason, version) ON payments TO legarec_staff;
GRANT SELECT (id, case_id, creditor_id, method, amount_cents, status, received_on, deposited_on, settled_at, bounced_at) ON payments TO legarec_worker;
GRANT SELECT (id, case_id, creditor_id, method, amount_cents, status, received_on) ON payments TO legarec_partner, legarec_debtor;

CALL app.secure_case_table('payment_allocations', ARRAY['partner', 'debtor']);
CREATE POLICY definer_read ON payment_allocations FOR SELECT TO legarec_definer USING (true);
GRANT SELECT (id, case_id, creditor_id, payment_id, invoice_id, component, amount_cents, reverses_id, created_at),
  INSERT (id, case_id, creditor_id, payment_id, invoice_id, component, amount_cents, reverses_id) ON payment_allocations TO legarec_staff;
GRANT SELECT (id, case_id, creditor_id, payment_id, invoice_id, component, amount_cents, reverses_id) ON payment_allocations TO legarec_worker, legarec_partner, legarec_debtor;
CREATE POLICY definer_follow ON case_invoices FOR UPDATE TO legarec_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_read ON case_invoices FOR SELECT TO legarec_definer USING (true);

CALL app.secure_case_table('receipts', ARRAY['debtor']);
GRANT SELECT (id, case_id, creditor_id, payment_id, number, document_id, issued_at), INSERT (id, case_id, creditor_id, payment_id, number) ON receipts TO legarec_staff;
GRANT SELECT (id, case_id, creditor_id, payment_id, number, document_id, issued_at), UPDATE (document_id) ON receipts TO legarec_worker;
GRANT SELECT (id, case_id, creditor_id, payment_id, number, issued_at) ON receipts TO legarec_debtor;

-- Plans: asked in one's own name, never already accepted; a creditor and a debtor read them.
CALL app.secure_case_table('payment_plans', ARRAY['partner', 'debtor']);
CREATE POLICY staff_asked ON payment_plans AS RESTRICTIVE FOR INSERT TO legarec_staff
  WITH CHECK (requested_by = (SELECT app.user_id()) AND on_behalf_of_id IS NOT DISTINCT FROM (SELECT app.on_behalf_of())
    AND status IN ('PENDING_MANAGER', 'WAITING_CREDITOR', 'WAITING_DEBTOR') AND accepted_at IS NULL AND version = 1);
-- The team cancels a plan or records what became of it; accepting is for the debtor, approving for the function above.
CREATE POLICY staff_status ON payment_plans AS RESTRICTIVE FOR UPDATE TO legarec_staff USING (true) WITH CHECK (status IN ('CANCELLED', 'ACTIVE', 'DONE', 'DEFAULT'));
CREATE POLICY definer_all ON payment_plans TO legarec_definer USING (true) WITH CHECK (true);
GRANT SELECT (id, case_id, creditor_id, total_cents, months, method, first_due_on, status, threshold_months, owned_by_director, requested_by, on_behalf_of_id,
  accepted_at, document_id, version, created_at),
  INSERT (id, case_id, creditor_id, total_cents, months, method, first_due_on, status, threshold_months, owned_by_director, requested_by, on_behalf_of_id, version),
  UPDATE (status, version) ON payment_plans TO legarec_staff;
GRANT SELECT (id, case_id, creditor_id, total_cents, months, method, first_due_on, status, accepted_at, version) ON payment_plans TO legarec_worker;
GRANT SELECT (id, case_id, creditor_id, total_cents, months, method, first_due_on, status, accepted_at) ON payment_plans TO legarec_partner, legarec_debtor;

CALL app.secure_case_table('plan_approvals', ARRAY['partner']);
CREATE POLICY staff_asked ON plan_approvals AS RESTRICTIVE FOR INSERT TO legarec_staff WITH CHECK (decision = 'PENDING' AND decided_at IS NULL);
-- The approvals of the team are decided by the function above only.
CREATE POLICY staff_never ON plan_approvals AS RESTRICTIVE FOR UPDATE TO legarec_staff USING (false);
CREATE POLICY definer_all ON plan_approvals TO legarec_definer USING (true) WITH CHECK (true);
CREATE POLICY partner_step ON plan_approvals AS RESTRICTIVE FOR SELECT TO legarec_partner USING (step = 'CREDITOR');
GRANT SELECT (id, case_id, creditor_id, plan_id, step, decision, decided_by, reason, on_behalf_of_id, decided_at), INSERT (id, case_id, creditor_id, plan_id, step, decision) ON plan_approvals TO legarec_staff;
GRANT SELECT (id, case_id, creditor_id, plan_id, step, decision, decided_at) ON plan_approvals TO legarec_worker, legarec_partner;

CALL app.secure_case_table('installments', ARRAY['partner', 'debtor']);
GRANT SELECT (id, case_id, creditor_id, plan_id, number, due_on, amount_cents), INSERT (id, case_id, creditor_id, plan_id, number, due_on, amount_cents) ON installments TO legarec_staff;
GRANT SELECT (id, case_id, creditor_id, plan_id, number, due_on, amount_cents) ON installments TO legarec_worker, legarec_partner, legarec_debtor;
