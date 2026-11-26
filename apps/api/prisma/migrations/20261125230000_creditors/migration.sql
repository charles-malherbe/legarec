-- Creditors: identity, contacts, mandates and their amendments, account of the remittances.

CREATE TYPE mandate_interest AS ENUM ('ECB_PLUS_TEN', 'CONTRACT', 'NONE');
CREATE TYPE scenario_code AS ENUM ('BUSINESS', 'CONSUMER', 'KEY_ACCOUNTS');

ALTER TABLE creditors
  ADD COLUMN legal_name text CHECK (length(legal_name) BETWEEN 1 AND 150),
  ADD COLUMN vat_number text CHECK (vat_number ~ '^FR[A-Z0-9]{2}[0-9]{9}$'),
  ADD COLUMN sector text CHECK (length(sector) <= 120),
  ADD COLUMN address text CHECK (length(address) <= 300),
  ADD COLUMN postal_code text CHECK (postal_code ~ '^[0-9]{5}$'),
  ADD COLUMN city text CHECK (length(city) <= 120),
  -- Receives the messages of the creditor.
  ADD COLUMN manager_id uuid REFERENCES users (id),
  ADD COLUMN version integer NOT NULL DEFAULT 1,
  ADD COLUMN updated_by uuid REFERENCES users (id),
  ADD COLUMN updated_at timestamptz(3) NOT NULL DEFAULT now();

CREATE TABLE creditor_contacts (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  creditor_id uuid NOT NULL REFERENCES creditors (id),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  title text CHECK (length(title) <= 120),
  email citext NOT NULL CHECK (length(email) <= 254),
  phone text CHECK (length(phone) <= 30),
  is_main boolean NOT NULL DEFAULT false,
  created_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX creditor_contacts_main ON creditor_contacts (creditor_id) WHERE is_main;
CREATE INDEX creditor_contacts_creditor ON creditor_contacts (creditor_id);

-- One line per version: an amendment closes the former one the day before it starts, and changes nothing of it.
CREATE TABLE mandates (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  creditor_id uuid NOT NULL REFERENCES creditors (id),
  amends_id uuid,
  starts_on date NOT NULL,
  ends_on date,
  amicable_rate_bp integer NOT NULL CHECK (amicable_rate_bp BETWEEN 0 AND 10000),
  litigation_rate_bp integer NOT NULL CHECK (litigation_rate_bp BETWEEN 0 AND 10000),
  opening_fee_cents integer NOT NULL DEFAULT 0 CHECK (opening_fee_cents BETWEEN 0 AND 2000000000),
  plan_months_without_consent integer NOT NULL CHECK (plan_months_without_consent IN (3, 6, 12)),
  discount_max_bp integer NOT NULL CHECK (discount_max_bp BETWEEN 0 AND 10000),
  litigation_needs_consent boolean NOT NULL,
  defer_small_remittances boolean NOT NULL DEFAULT false,
  interest_mode mandate_interest NOT NULL,
  contract_rate_bp integer CHECK (contract_rate_bp BETWEEN 0 AND 10000),
  fixed_indemnity boolean NOT NULL,
  reporting_day integer NOT NULL CHECK (reporting_day BETWEEN 1 AND 28),
  scenario scenario_code NOT NULL,
  created_by uuid REFERENCES users (id),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  -- Target of the composite key of the cases.
  CONSTRAINT mandates_id_creditor UNIQUE (id, creditor_id),
  FOREIGN KEY (amends_id, creditor_id) REFERENCES mandates (id, creditor_id),
  CONSTRAINT mandates_dates CHECK (ends_on IS NULL OR ends_on >= starts_on),
  CONSTRAINT mandates_contract_rate CHECK ((interest_mode = 'CONTRACT') = (contract_rate_bp IS NOT NULL)),
  -- Never two at the same time.
  CONSTRAINT mandates_single EXCLUDE USING gist (creditor_id WITH =, daterange(starts_on, ends_on, '[]') WITH &&)
);

CREATE TABLE creditor_bank_accounts (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  creditor_id uuid NOT NULL REFERENCES creditors (id),
  holder text NOT NULL CHECK (length(btrim(holder)) BETWEEN 1 AND 150),
  iban_cipher bytea NOT NULL,
  -- « FR76 •••• 4521 »
  iban_masked text NOT NULL CHECK (iban_masked ~ '^[A-Z]{2}[0-9]{2} •••• •••• [A-Z0-9]{4}$'),
  bic text NOT NULL CHECK (bic ~ '^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$'),
  valid_from timestamptz(3) NOT NULL DEFAULT now(),
  valid_until timestamptz(3),
  -- By telephone, at a number already known: nothing is remitted before.
  confirmed_by uuid REFERENCES users (id),
  confirmed_at timestamptz(3),
  confirmed_with text CHECK (length(confirmed_with) <= 120),
  created_by uuid NOT NULL REFERENCES users (id),
  on_behalf_of_id uuid REFERENCES users (id),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT creditor_bank_accounts_confirmed CHECK ((confirmed_by IS NULL) = (confirmed_at IS NULL) AND (confirmed_by IS NULL) = (confirmed_with IS NULL))
);
CREATE UNIQUE INDEX creditor_bank_accounts_current ON creditor_bank_accounts (creditor_id) WHERE valid_until IS NULL;

-- ---------------------------------------------------------------- The whole IBAN: to whom may act on it, and noted by the API

GRANT CREATE ON SCHEMA app TO legarec_definer;
GRANT SELECT (id, creditor_id, iban_cipher) ON creditor_bank_accounts TO legarec_definer;
SET LOCAL ROLE legarec_definer;
CREATE FUNCTION app.creditor_iban(account uuid) RETURNS bytea LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT iban_cipher FROM public.creditor_bank_accounts WHERE id = account AND app.acts_as_director('ADMINISTRATIVE')
$$;
GRANT EXECUTE ON FUNCTION app.creditor_iban(uuid) TO legarec_staff;
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM legarec_definer;

-- ---------------------------------------------------------------- Policies and rights

CALL app.secure('creditor_contacts');
CALL app.secure('mandates');
CALL app.secure('creditor_bank_accounts');

-- The Director and the manager, in their own right.
CREATE POLICY staff_add ON creditors FOR INSERT TO legarec_staff WITH CHECK ((SELECT app.staff_role()) IN ('DIRECTOR', 'COLLECTION_MANAGER'));
CREATE POLICY staff_change ON creditors FOR UPDATE TO legarec_staff USING ((SELECT app.staff_role()) IN ('DIRECTOR', 'COLLECTION_MANAGER')) WITH CHECK ((SELECT app.staff_role()) IN ('DIRECTOR', 'COLLECTION_MANAGER'));
-- The SIREN is that of a legal person: typed once.
GRANT SELECT (legal_name, vat_number, sector, address, postal_code, city, manager_id, version, updated_by, updated_at),
  INSERT (id, name, siren, status, version, created_at, updated_at, legal_name, vat_number, sector, address, postal_code, city, manager_id, portal_enabled, updated_by),
  UPDATE (name, legal_name, vat_number, sector, address, postal_code, city, manager_id, portal_enabled, version, updated_by, updated_at) ON creditors TO legarec_staff;
GRANT SELECT (legal_name, address, postal_code, city) ON creditors TO legarec_worker;

DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['creditor_contacts', 'mandates'] LOOP
    EXECUTE format('CREATE POLICY staff_read ON %I FOR SELECT TO legarec_staff USING (creditor_id IN (SELECT c.id FROM creditors c))', name);
    EXECUTE format('CREATE POLICY staff_add ON %I FOR INSERT TO legarec_staff WITH CHECK ((SELECT app.staff_role()) IN (''DIRECTOR'', ''COLLECTION_MANAGER''))', name);
    EXECUTE format('CREATE POLICY staff_change ON %I FOR UPDATE TO legarec_staff USING ((SELECT app.staff_role()) IN (''DIRECTOR'', ''COLLECTION_MANAGER'')) WITH CHECK ((SELECT app.staff_role()) IN (''DIRECTOR'', ''COLLECTION_MANAGER''))', name);
    EXECUTE format('CREATE POLICY worker_read ON %I FOR SELECT TO legarec_worker USING (true)', name);
  END LOOP;
END
$$;
CREATE POLICY staff_typed ON mandates AS RESTRICTIVE FOR INSERT TO legarec_staff WITH CHECK (created_by = (SELECT app.user_id()));
CREATE POLICY staff_remove ON creditor_contacts FOR DELETE TO legarec_staff USING ((SELECT app.staff_role()) IN ('DIRECTOR', 'COLLECTION_MANAGER'));
GRANT SELECT (id, creditor_id, name, title, email, phone, is_main, created_at), INSERT (id, creditor_id, name, title, email, phone, is_main, created_at), DELETE ON creditor_contacts TO legarec_staff;
GRANT SELECT (id, creditor_id, name, title, email, phone, is_main) ON creditor_contacts TO legarec_worker;
-- The terms of a mandate never change: it ends, and another one follows.
GRANT SELECT (id, creditor_id, amends_id, starts_on, ends_on, amicable_rate_bp, litigation_rate_bp, opening_fee_cents, plan_months_without_consent, discount_max_bp,
    litigation_needs_consent, defer_small_remittances, interest_mode, contract_rate_bp, fixed_indemnity, reporting_day, scenario, created_by, created_at) ON mandates TO legarec_staff, legarec_worker;
GRANT INSERT (id, creditor_id, amends_id, starts_on, ends_on, amicable_rate_bp, litigation_rate_bp, opening_fee_cents, plan_months_without_consent, discount_max_bp,
    litigation_needs_consent, defer_small_remittances, interest_mode, contract_rate_bp, fixed_indemnity, reporting_day, scenario, created_by, created_at), UPDATE (ends_on) ON mandates TO legarec_staff;

-- Account of the remittances: the Director, or the manager on their behalf. Its IBAN is read by the function above alone.
CREATE POLICY definer_read ON creditor_bank_accounts FOR SELECT TO legarec_definer USING (true);
CREATE POLICY staff_read ON creditor_bank_accounts FOR SELECT TO legarec_staff USING ((SELECT app.staff_role()) = 'DIRECTOR' OR (SELECT app.has_delegation('ADMINISTRATIVE')));
-- In one's own name, the telephone call too.
CREATE POLICY staff_add ON creditor_bank_accounts FOR INSERT TO legarec_staff WITH CHECK (
  (SELECT app.acts_as_director('ADMINISTRATIVE')) AND created_by = (SELECT app.user_id()) AND (confirmed_by IS NULL OR confirmed_by = (SELECT app.user_id()))
  AND on_behalf_of_id IS NOT DISTINCT FROM (SELECT app.on_behalf_of()));
CREATE POLICY staff_change ON creditor_bank_accounts FOR UPDATE TO legarec_staff USING ((SELECT app.acts_as_director('ADMINISTRATIVE'))) WITH CHECK ((SELECT app.acts_as_director('ADMINISTRATIVE')));
GRANT SELECT (id, creditor_id, holder, iban_masked, bic, valid_from, valid_until, confirmed_by, confirmed_at, confirmed_with, created_by, on_behalf_of_id),
  INSERT (id, creditor_id, holder, iban_cipher, iban_masked, bic, confirmed_by, confirmed_at, confirmed_with, created_by, on_behalf_of_id),
  UPDATE (valid_until, confirmed_by, confirmed_at, confirmed_with) ON creditor_bank_accounts TO legarec_staff;
CREATE POLICY worker_read ON creditor_bank_accounts FOR SELECT TO legarec_worker USING (true);
-- Closed for good; confirmed once, by whoever made the call.
CREATE FUNCTION app.keep_account_history() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF OLD.valid_until IS NOT NULL OR NEW.valid_until > clock_timestamp() + interval '1 minute'
    OR ((NEW.confirmed_by, NEW.confirmed_at, NEW.confirmed_with) IS DISTINCT FROM (OLD.confirmed_by, OLD.confirmed_at, OLD.confirmed_with)
      AND (OLD.confirmed_by IS NOT NULL OR NEW.confirmed_by IS DISTINCT FROM app.user_id())) THEN
    RAISE EXCEPTION 'account history kept' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER keep_history BEFORE UPDATE ON creditor_bank_accounts FOR EACH ROW EXECUTE FUNCTION app.keep_account_history();
