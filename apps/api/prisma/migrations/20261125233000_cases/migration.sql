-- Cases: how they are opened, their invoices and the coordinates of the debtor for that creditor.

CREATE TYPE invoice_state AS ENUM ('UNPAID', 'PARTIAL', 'DISPUTED', 'REMINDED', 'PLAN', 'PAID');
CREATE TYPE contact_kind AS ENUM ('PHONE', 'EMAIL');
CREATE TYPE contact_status AS ENUM ('VERIFIED', 'INVALID', 'UNVERIFIED', 'NEW', 'PENDING');
CREATE TYPE contact_source AS ENUM ('CALL', 'IMPORT', 'DOCUMENT', 'CREDITOR');

ALTER TABLE cases
  -- The terms of the day it was opened: an amendment changes nothing of it.
  ADD COLUMN mandate_id uuid,
  ADD COLUMN debtor_siret text CHECK (debtor_siret ~ '^[0-9]{14}$'),
  ADD COLUMN debtor_address text CHECK (length(debtor_address) <= 300),
  ADD COLUMN debtor_postal_code text CHECK (debtor_postal_code ~ '^[0-9]{5}$'),
  ADD COLUMN debtor_city text CHECK (length(debtor_city) <= 120),
  ADD COLUMN contact_name text CHECK (length(contact_name) <= 120),
  ADD COLUMN contact_title text CHECK (length(contact_title) <= 120),
  ADD COLUMN scenario scenario_code,
  ADD COLUMN created_by uuid REFERENCES users (id),
  ADD FOREIGN KEY (mandate_id, creditor_id) REFERENCES mandates (id, creditor_id);

CREATE TABLE case_invoices (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  case_id uuid NOT NULL,
  creditor_id uuid NOT NULL,
  number text NOT NULL CHECK (length(btrim(number)) BETWEEN 1 AND 60),
  external_ref text CHECK (length(external_ref) <= 60),
  issued_on date NOT NULL,
  due_on date NOT NULL,
  -- With tax, as invoiced; then what was left to pay when the case was opened.
  claimed_cents integer NOT NULL CHECK (claimed_cents BETWEEN 1 AND 2000000000),
  principal_cents integer NOT NULL,
  principal_paid_cents integer NOT NULL DEFAULT 0,
  state invoice_state NOT NULL DEFAULT 'UNPAID',
  created_by uuid REFERENCES users (id),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  FOREIGN KEY (case_id, creditor_id) REFERENCES cases (id, creditor_id),
  UNIQUE (case_id, number),
  CONSTRAINT case_invoices_dates CHECK (due_on >= issued_on),
  CONSTRAINT case_invoices_principal CHECK (principal_cents BETWEEN 1 AND claimed_cents),
  CONSTRAINT case_invoices_paid CHECK (principal_paid_cents BETWEEN 0 AND principal_cents)
);
CREATE INDEX case_invoices_due ON case_invoices (due_on) WHERE principal_paid_cents < principal_cents;

-- Those of one creditor are never those of another (question 79).
CREATE TABLE case_contacts (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  case_id uuid NOT NULL,
  creditor_id uuid NOT NULL,
  kind contact_kind NOT NULL,
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 40),
  value text NOT NULL CHECK (length(value) BETWEEN 3 AND 254),
  value_normalized text NOT NULL CHECK (length(value_normalized) BETWEEN 3 AND 254),
  status contact_status NOT NULL DEFAULT 'UNVERIFIED',
  is_primary boolean NOT NULL DEFAULT false,
  source contact_source NOT NULL,
  replaced_by_id uuid,
  created_by uuid REFERENCES users (id),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  invalidated_at timestamptz(3),
  FOREIGN KEY (case_id, creditor_id) REFERENCES cases (id, creditor_id),
  UNIQUE (id, case_id),
  FOREIGN KEY (replaced_by_id, case_id) REFERENCES case_contacts (id, case_id),
  CONSTRAINT case_contacts_invalid CHECK ((status = 'INVALID') = (invalidated_at IS NOT NULL) AND NOT (status = 'INVALID' AND is_primary)),
  CONSTRAINT case_contacts_replaced CHECK (replaced_by_id IS NULL OR status = 'INVALID')
);
CREATE UNIQUE INDEX case_contacts_primary ON case_contacts (case_id, kind) WHERE is_primary;
CREATE UNIQUE INDEX case_contacts_value ON case_contacts (case_id, kind, value_normalized) WHERE status <> 'INVALID';
CREATE INDEX case_contacts_lookup ON case_contacts (value_normalized);

CREATE TABLE case_contact_events (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  case_id uuid NOT NULL,
  creditor_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  actor_id uuid,
  actor_label text NOT NULL,
  what text NOT NULL CHECK (what IN ('ADDED', 'REPLACED', 'VERIFIED', 'INVALIDATED', 'MADE_PRIMARY', 'CHANGED')),
  occurred_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (case_id, creditor_id) REFERENCES cases (id, creditor_id),
  FOREIGN KEY (contact_id, case_id) REFERENCES case_contacts (id, case_id)
);
CREATE INDEX case_contact_events_case ON case_contact_events (case_id, occurred_at DESC);
CALL app.append_only('case_contact_events');

-- ---------------------------------------------------------------- Functions that see more than their caller

GRANT CREATE ON SCHEMA app TO legarec_definer;
GRANT SELECT (id, siren, name, kind), INSERT (id, kind, name, siren, legal_form_code, legal_form_source, legal_form_checked_at) ON debtors TO legarec_definer;
GRANT SELECT (id, case_id, creditor_id) ON case_contacts TO legarec_definer;
GRANT INSERT (case_id, creditor_id, contact_id, actor_id, actor_label, what) ON case_contact_events TO legarec_definer;
SET LOCAL ROLE legarec_definer;

-- « Bâtiplus S.A.S. » and « BATIPLUS » are the same name, « Dupont & Fils » and « DUPONT ET FILS » too.
CREATE FUNCTION app.plain_name(name text) RETURNS text LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT coalesce(nullif(regexp_replace(regexp_replace(replace(replace(lower(unaccent(name)), '.', ''), '&', ' et '),
    '\m(sasu?|sarl|eurl|sa|snc|scs|sca|sci|scop|selarl|selas|ei|eirl|gie|ste|societe)\M', '', 'g'), '[^a-z0-9]', '', 'g'), ''), lower(btrim(name)))
$$;
-- A company already known is the same debtor for every creditor, without anything of it being shown: neither its name, which
-- never changes here, nor its cases. Null when what was confirmed is not that debtor. Two individuals are never put together.
CREATE FUNCTION app.open_debtor(wanted_kind debtor_kind, wanted_name text, wanted_siren text, form_code text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  known uuid;
BEGIN
  IF app.staff_role() IS NULL OR app.staff_role() NOT IN ('DIRECTOR', 'COLLECTION_MANAGER') OR (wanted_kind = 'INDIVIDUAL') <> (wanted_siren IS NULL) THEN
    PERFORM app.refuse('42501');
  END IF;
  IF wanted_siren IS NOT NULL THEN
    -- One after the other for a SIREN: the second one finds the first.
    PERFORM pg_advisory_xact_lock(hashtextextended('debtor:' || wanted_siren, 0));
    SELECT d.id INTO known FROM public.debtors d WHERE d.siren = wanted_siren;
    IF FOUND THEN
      RETURN (SELECT d.id FROM public.debtors d WHERE d.id = known AND d.kind = wanted_kind AND app.plain_name(d.name) = app.plain_name(wanted_name));
    END IF;
  END IF;
  known := app.uuid_v7();
  INSERT INTO public.debtors (id, kind, name, siren, legal_form_code, legal_form_source, legal_form_checked_at)
  VALUES (known, wanted_kind, wanted_name, wanted_siren, form_code, CASE WHEN form_code IS NOT NULL THEN 'STAFF' END, CASE WHEN form_code IS NOT NULL THEN now() END);
  RETURN known;
END
$$;
-- Whoever acts on the case says what they did to a coordinate of it.
CREATE FUNCTION app.note_contact(target uuid, wanted text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  INSERT INTO public.case_contact_events (case_id, creditor_id, contact_id, actor_id, actor_label, what)
  SELECT k.case_id, k.creditor_id, k.id, app.actor_id(), app.actor_label(), wanted
  FROM public.case_contacts k JOIN public.cases c ON c.id = k.case_id
  WHERE k.id = target AND app.can_act_on_case(c.officer_id);
  IF NOT FOUND THEN
    PERFORM app.refuse('42501');
  END IF;
END
$$;
-- As before, and written in the history of each case.
CREATE OR REPLACE FUNCTION app.assign_cases(targets uuid[], officer uuid) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  changed uuid[];
BEGIN
  IF app.staff_role() IS DISTINCT FROM 'DIRECTOR' AND (app.setting('acting_for') IS DISTINCT FROM 'ADMINISTRATIVE' OR app.on_behalf_of() IS NULL) THEN
    RAISE EXCEPTION 'assignment refused' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF officer IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.users u WHERE u.id = officer AND u.status = 'ACTIVE' AND u.role IN ('DIRECTOR', 'COLLECTION_MANAGER', 'CLAIMS_OFFICER')
  ) THEN
    RAISE EXCEPTION 'invalid officer' USING ERRCODE = 'check_violation';
  END IF;
  WITH done AS (
    UPDATE public.cases c SET officer_id = officer, version = c.version + 1
    WHERE c.id = ANY (targets) AND app.can_read_case(c.officer_id) AND c.officer_id IS DISTINCT FROM officer
    RETURNING c.id
  ) SELECT coalesce(array_agg(done.id), '{}') INTO changed FROM done;
  INSERT INTO public.case_events (case_id, creditor_id, kind, title, actor_kind, actor_id, actor_label, on_behalf_of_id)
  SELECT c.id, c.creditor_id, CASE WHEN officer IS NULL THEN 'CASE_RELEASED' ELSE 'CASE_ASSIGNED' END, CASE WHEN officer IS NULL THEN 'Dossier sans gestionnaire' ELSE 'Dossier attribué' END,
    app.actor_kind(), app.actor_id(), app.actor_label(), app.on_behalf_of()
  FROM public.cases c WHERE c.id = ANY (changed);
  RETURN cardinality(changed);
END
$$;
GRANT EXECUTE ON FUNCTION app.open_debtor(debtor_kind, text, text, text), app.note_contact(uuid, text) TO legarec_staff;
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM legarec_definer;

-- ---------------------------------------------------------------- Policies and rights

CREATE POLICY definer_read ON debtors FOR SELECT TO legarec_definer USING (true);
CREATE POLICY definer_add ON debtors FOR INSERT TO legarec_definer WITH CHECK (true);

-- Opened by the Director or the manager (D1), for themselves or for nobody: giving it to someone else is another right.
CREATE POLICY staff_open ON cases FOR INSERT TO legarec_staff WITH CHECK (
  status = 'NEW' AND first_letter_on IS NULL AND created_by = (SELECT app.user_id())
  AND CASE (SELECT app.staff_role())
    WHEN 'DIRECTOR' THEN officer_id = (SELECT app.user_id())
    WHEN 'COLLECTION_MANAGER' THEN officer_id IS NULL OR officer_id = (SELECT app.user_id())
    ELSE false
  END);
GRANT SELECT (mandate_id, debtor_siret, debtor_address, debtor_postal_code, debtor_city, contact_name, contact_title, scenario, created_by) ON cases TO legarec_staff, legarec_worker;
GRANT INSERT (id, reference, creditor_id, debtor_id, officer_id, status, external_reference, opened_on, version, created_at, mandate_id, debtor_siret, debtor_address,
  debtor_postal_code, debtor_city, contact_name, contact_title, scenario, created_by) ON cases TO legarec_staff;

CALL app.secure_case_table('case_invoices', ARRAY['partner', 'debtor']);
GRANT SELECT (id, case_id, creditor_id, number, external_ref, issued_on, due_on, claimed_cents, principal_cents, principal_paid_cents, state, created_by, created_at),
  INSERT (id, case_id, creditor_id, number, external_ref, issued_on, due_on, claimed_cents, principal_cents, principal_paid_cents, state, created_by, created_at) ON case_invoices TO legarec_staff;
GRANT SELECT (id, case_id, creditor_id, number, external_ref, issued_on, due_on, claimed_cents, principal_cents, principal_paid_cents, state, created_at) ON case_invoices TO legarec_worker;
GRANT SELECT (id, case_id, creditor_id, number, external_ref, issued_on, due_on, claimed_cents, principal_cents, principal_paid_cents, state) ON case_invoices TO legarec_partner, legarec_debtor;

-- In one's own name, and as they are when they are typed: neither paid nor verified.
CREATE POLICY staff_typed ON case_invoices AS RESTRICTIVE FOR INSERT TO legarec_staff
  WITH CHECK (created_by = (SELECT app.user_id()) AND principal_paid_cents = 0 AND state = 'UNPAID');

-- Coordinates: neither the creditor nor the debtor reads them.
CALL app.secure_case_table('case_contacts');
CREATE POLICY staff_typed ON case_contacts AS RESTRICTIVE FOR INSERT TO legarec_staff
  WITH CHECK (created_by = (SELECT app.user_id()) AND status IN ('UNVERIFIED', 'NEW'));
GRANT SELECT (id, case_id, creditor_id, kind, label, value, value_normalized, status, is_primary, source, replaced_by_id, created_by, created_at, invalidated_at),
  INSERT (id, case_id, creditor_id, kind, label, value, value_normalized, status, is_primary, source, created_by, created_at),
  UPDATE (status, is_primary, replaced_by_id, invalidated_at) ON case_contacts TO legarec_staff;
GRANT SELECT (id, case_id, creditor_id, kind, label, value, value_normalized, status, is_primary) ON case_contacts TO legarec_worker;
CREATE POLICY definer_read ON case_contacts FOR SELECT TO legarec_definer USING (true);

CALL app.secure('case_contact_events');
CREATE POLICY definer_add ON case_contact_events FOR INSERT TO legarec_definer WITH CHECK (true);
CREATE POLICY staff_read ON case_contact_events FOR SELECT TO legarec_staff USING (case_id IN (SELECT c.id FROM cases c));
GRANT SELECT (id, case_id, creditor_id, contact_id, actor_id, actor_label, what, occurred_at) ON case_contact_events TO legarec_staff;
