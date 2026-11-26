-- A claim deposited by a creditor waits for the team before it becomes a case (question 155, 26/11/2026): the Director or
-- the manager opens it, or refuses it with a reason. Nothing of the debtor is created before. What the creditor gave is
-- emptied once decided; the deposit itself goes 30 days later (apps/api/src/platform/queue/maintenance.ts).

CREATE TYPE deposit_status AS ENUM ('PENDING', 'ACCEPTED', 'REFUSED');

CREATE TABLE claim_deposits (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  creditor_id uuid NOT NULL REFERENCES creditors (id),
  deposited_by uuid NOT NULL REFERENCES users (id),
  -- As the creditor gave it, never taken on trust; emptied once decided.
  debtor_name text CHECK (length(btrim(debtor_name)) BETWEEN 1 AND 150),
  siret text CHECK (siret ~ '^[0-9]{14}$'),
  address text CHECK (length(address) <= 300),
  email text CHECK (length(email) <= 254),
  phone text CHECK (length(phone) <= 30),
  invoices jsonb CHECK (jsonb_typeof(invoices) = 'array' AND jsonb_array_length(invoices) BETWEEN 1 AND 50),
  files uuid[] NOT NULL DEFAULT '{}' CHECK (cardinality(files) <= 20),
  total_cents bigint NOT NULL CHECK (total_cents > 0),
  invoice_count integer NOT NULL CHECK (invoice_count BETWEEN 1 AND 50),
  status deposit_status NOT NULL DEFAULT 'PENDING',
  reason text CHECK (length(btrim(reason)) BETWEEN 5 AND 500),
  decided_by uuid REFERENCES users (id),
  on_behalf_of_id uuid REFERENCES users (id),
  decided_at timestamptz(3),
  -- The case it became: not a table of the case (purged 30 days after the decision, long before any anonymization).
  opened_case uuid REFERENCES cases (id),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT claim_deposits_decided CHECK ((status = 'PENDING') = (decided_at IS NULL) AND (decided_at IS NULL) = (decided_by IS NULL)),
  CONSTRAINT claim_deposits_content CHECK ((status = 'PENDING') = (debtor_name IS NOT NULL AND invoices IS NOT NULL)),
  CONSTRAINT claim_deposits_reason CHECK ((status = 'REFUSED') = (reason IS NOT NULL)),
  CONSTRAINT claim_deposits_case CHECK ((status = 'ACCEPTED') = (opened_case IS NOT NULL))
);
CREATE INDEX claim_deposits_waiting ON claim_deposits (created_at) WHERE status = 'PENDING';
CREATE INDEX claim_deposits_day ON claim_deposits (creditor_id, created_at);
CREATE INDEX claim_deposits_decided_at ON claim_deposits (decided_at) WHERE status <> 'PENDING';

-- Read by the Director and the manager alone; the creditor reads none (« Message seul »), nobody writes but the functions below.
CALL app.secure('claim_deposits');
CREATE POLICY staff_read ON claim_deposits FOR SELECT TO legarec_staff USING ((SELECT app.staff_role()) IN ('DIRECTOR', 'COLLECTION_MANAGER'));
CREATE POLICY definer_all ON claim_deposits TO legarec_definer USING (true) WITH CHECK (true);
CREATE POLICY retention_purge ON claim_deposits FOR DELETE TO legarec_retention USING (status <> 'PENDING' AND decided_at < now() - interval '30 days');
CREATE POLICY retention_read ON claim_deposits FOR SELECT TO legarec_retention USING (true);
GRANT SELECT (id, creditor_id, deposited_by, debtor_name, siret, address, email, phone, invoices, files, total_cents, invoice_count, status, reason, decided_by,
  on_behalf_of_id, decided_at, opened_case, created_at) ON claim_deposits TO legarec_staff;
GRANT SELECT, INSERT, UPDATE ON claim_deposits TO legarec_definer;
GRANT SELECT (id, status, decided_at), DELETE ON claim_deposits TO legarec_retention;

-- A deposit opens no case any more: the policies that let it are gone; only the opening by the team below writes one.
DROP POLICY definer_deposit ON cases;
DROP POLICY definer_deposit ON case_invoices;
DROP POLICY definer_deposit ON case_contacts;
GRANT SELECT (purged_at) ON documents TO legarec_definer;

-- The case opened from a deposit takes its id: these let the definer write it, and nothing else, while the deposit waits.
CREATE POLICY definer_accept ON cases FOR INSERT TO legarec_definer WITH CHECK (
  status = 'NEW' AND officer_id IS NULL AND (SELECT app.staff_role()) IN ('DIRECTOR', 'COLLECTION_MANAGER')
  AND EXISTS (SELECT 1 FROM claim_deposits d WHERE d.id = cases.id AND d.creditor_id = cases.creditor_id AND d.status = 'PENDING'));
CREATE POLICY definer_accept ON case_invoices FOR INSERT TO legarec_definer WITH CHECK (
  EXISTS (SELECT 1 FROM claim_deposits d WHERE d.id = case_invoices.case_id AND d.creditor_id = case_invoices.creditor_id AND d.status = 'PENDING'));
CREATE POLICY definer_accept ON case_contacts FOR INSERT TO legarec_definer WITH CHECK (
  source = 'CREDITOR' AND status = 'UNVERIFIED'
  AND EXISTS (SELECT 1 FROM claim_deposits d WHERE d.id = case_contacts.case_id AND d.creditor_id = case_contacts.creditor_id AND d.status = 'PENDING'));

GRANT CREATE ON SCHEMA app TO legarec_definer;
SET LOCAL ROLE legarec_definer;

-- The deposit itself. `outcome`: DEPOSITED, NO_MANDATE, CASE_EXISTS (a case of this creditor is open for that debtor), FILES
-- (files that are not its own, waiting), TOO_MANY (more than 500 a day). Whether the SIREN is known is never told, and
-- nothing of the debtor is written before the team opens the case.
CREATE OR REPLACE FUNCTION app.creditor_deposit(wanted_name text, siret text, address text, email text, phone text, invoices jsonb, files uuid[],
  OUT outcome text, OUT opened uuid, OUT ref text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  holder uuid := app.partner_creditor();
  today date := (now() AT TIME ZONE 'Europe/Paris')::date;
  wanted_siren text := CASE WHEN coalesce(siret, '') <> '' THEN left(siret, 9) END;
  total bigint;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'CREDITOR' OR holder IS NULL OR jsonb_typeof(invoices) <> 'array' OR jsonb_array_length(invoices) NOT BETWEEN 1 AND 50 THEN
    PERFORM app.refuse('42501');
  END IF;
  -- Each line as the opening will read it: a date, a date, an amount, a number (refused here rather than at the opening).
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(invoices) AS line
      WHERE (line ->> 'issuedOn')::date IS NULL OR (line ->> 'dueOn')::date IS NULL OR (line ->> 'amount')::bigint NOT BETWEEN 1 AND 2147483647
        OR length(btrim(coalesce(line ->> 'number', ''))) NOT BETWEEN 1 AND 60) THEN
    PERFORM app.refuse('42501');
  END IF;
  -- One deposit of this creditor at a time: its files, its count of the day.
  PERFORM pg_advisory_xact_lock(hashtextextended('deposits:' || holder::text, 0));
  -- Its own files, waiting, and not already given with another deposit that waits.
  IF cardinality(coalesce(files, '{}')) > 20 OR (SELECT count(*) FROM public.documents d WHERE d.id = ANY (coalesce(files, '{}')) AND d.uploaded_by_creditor = holder
      AND d.case_id IS NULL AND d.purged_at IS NULL) <> cardinality(coalesce(files, '{}'))
    OR EXISTS (SELECT 1 FROM public.claim_deposits k WHERE k.creditor_id = holder AND k.status = 'PENDING' AND k.files && coalesce(creditor_deposit.files, '{}')) THEN
    outcome := 'FILES';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.mandates m WHERE m.creditor_id = holder AND m.starts_on <= today AND (m.ends_on IS NULL OR m.ends_on >= today)) THEN
    outcome := 'NO_MANDATE';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM public.claim_deposits k WHERE k.creditor_id = holder AND k.created_at > now() - interval '1 day') >= 500 THEN
    outcome := 'TOO_MANY';
    RETURN;
  END IF;
  -- Its own cases: the creditor knows them already.
  IF wanted_siren IS NOT NULL AND EXISTS (SELECT 1 FROM public.cases c JOIN public.debtors d ON d.id = c.debtor_id
      WHERE c.creditor_id = holder AND d.siren = wanted_siren AND c.closed_on IS NULL) THEN
    outcome := 'CASE_EXISTS';
    RETURN;
  END IF;
  SELECT sum((line ->> 'amount')::bigint) INTO total FROM jsonb_array_elements(invoices) AS line;
  opened := app.uuid_v7();
  INSERT INTO public.claim_deposits (id, creditor_id, deposited_by, debtor_name, siret, address, email, phone, invoices, files, total_cents, invoice_count)
  VALUES (opened, holder, app.user_id(), btrim(wanted_name), nullif(siret, ''), btrim(address), nullif(btrim(coalesce(email, '')), ''), nullif(btrim(coalesce(phone, '')), ''),
    invoices, coalesce(files, '{}'), total, jsonb_array_length(invoices));
  PERFORM app.log('CASE_DEPOSITED', 'claim_deposit', opened, jsonb_build_object('count', least(jsonb_array_length(invoices), 999)));
  outcome := 'DEPOSITED';
END
$$;

-- Opened by the Director or the manager: the case of the deposit, held by nobody, under the mandate in force today, as a
-- deposit opened it before (question 155). `expected`: the total that was shown. Outcome: OPENED, CHANGED, NO_MANDATE,
-- CASE_EXISTS; NULL when there is no such deposit.
CREATE FUNCTION app.accept_deposit(target uuid, expected bigint, OUT outcome text, OUT opened uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  deposit public.claim_deposits%ROWTYPE;
  mandate record;
  wanted_siren text;
  debtor uuid;
  this_year integer := extract(year FROM now() AT TIME ZONE 'Europe/Paris');
  drawn integer;
  taken integer;
  today date := (now() AT TIME ZONE 'Europe/Paris')::date;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'STAFF' OR app.staff_role() IS NULL OR app.staff_role() NOT IN ('DIRECTOR', 'COLLECTION_MANAGER') THEN
    PERFORM app.refuse('42501');
  END IF;
  SELECT * INTO deposit FROM public.claim_deposits k WHERE k.id = target FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF deposit.status <> 'PENDING' OR deposit.total_cents IS DISTINCT FROM expected THEN
    outcome := 'CHANGED';
    RETURN;
  END IF;
  SELECT m.id, m.scenario INTO mandate FROM public.mandates m
  WHERE m.creditor_id = deposit.creditor_id AND m.starts_on <= today AND (m.ends_on IS NULL OR m.ends_on >= today) ORDER BY m.starts_on DESC LIMIT 1;
  IF NOT FOUND THEN
    outcome := 'NO_MANDATE';
    RETURN;
  END IF;
  wanted_siren := left(deposit.siret, 9);
  IF wanted_siren IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('debtor:' || wanted_siren, 0));
    SELECT d.id INTO debtor FROM public.debtors d WHERE d.siren = wanted_siren;
  END IF;
  IF debtor IS NOT NULL AND EXISTS (SELECT 1 FROM public.cases c WHERE c.creditor_id = deposit.creditor_id AND c.debtor_id = debtor AND c.closed_on IS NULL) THEN
    outcome := 'CASE_EXISTS';
    RETURN;
  END IF;
  IF debtor IS NULL THEN
    debtor := app.uuid_v7();
    INSERT INTO public.debtors (id, kind, name, siren, name_confirmed)
    VALUES (debtor, CASE WHEN wanted_siren IS NULL THEN 'INDIVIDUAL' ELSE 'COMPANY' END::debtor_kind, deposit.debtor_name, wanted_siren, false);
  END IF;
  INSERT INTO public.number_sequences AS s (kind, year, last_value) VALUES ('CASE', this_year, 1)
  ON CONFLICT (kind, year) DO UPDATE SET last_value = s.last_value + 1 RETURNING last_value INTO drawn;
  -- The case takes the id of its deposit: the policies above let nothing else be written.
  opened := deposit.id;
  INSERT INTO public.cases (id, reference, creditor_id, debtor_id, status, mandate_id, debtor_siret, debtor_address, scenario, deposited_name)
  VALUES (opened, format('LGR-%s-%s', this_year, lpad(drawn::text, 5, '0')), deposit.creditor_id, debtor, 'NEW', mandate.id, deposit.siret, deposit.address,
    mandate.scenario, deposit.debtor_name);
  INSERT INTO public.case_invoices (case_id, creditor_id, number, issued_on, due_on, claimed_cents, principal_cents)
  SELECT opened, deposit.creditor_id, btrim(line ->> 'number'), (line ->> 'issuedOn')::date, (line ->> 'dueOn')::date, (line ->> 'amount')::integer, (line ->> 'amount')::integer
  FROM jsonb_array_elements(deposit.invoices) AS line;
  -- What the creditor gives is neither verified nor used to send the access code (question 112).
  IF deposit.email IS NOT NULL THEN
    INSERT INTO public.case_contacts (case_id, creditor_id, kind, label, value, value_normalized, status, is_primary, source)
    VALUES (opened, deposit.creditor_id, 'EMAIL', 'Fournie par le créancier', deposit.email, lower(deposit.email), 'UNVERIFIED', true, 'CREDITOR');
  END IF;
  IF length(regexp_replace(coalesce(deposit.phone, ''), '\D', '', 'g')) >= 3 THEN
    INSERT INTO public.case_contacts (case_id, creditor_id, kind, label, value, value_normalized, status, is_primary, source)
    VALUES (opened, deposit.creditor_id, 'PHONE', 'Fourni par le créancier', deposit.phone,
      regexp_replace(regexp_replace(deposit.phone, '\D', '', 'g'), '^33(?=[1-9])', '0'), 'UNVERIFIED', true, 'CREDITOR');
  END IF;
  UPDATE public.documents d SET case_id = opened, creditor_id = deposit.creditor_id
  WHERE d.id = ANY (deposit.files) AND d.case_id IS NULL AND d.uploaded_by_creditor = deposit.creditor_id;
  GET DIAGNOSTICS taken = ROW_COUNT;
  IF taken <> cardinality(deposit.files) THEN
    PERFORM app.refuse('LG409');
  END IF;
  INSERT INTO public.case_events (case_id, creditor_id, kind, title, tone, actor_kind, actor_id, actor_label, visible_to_creditor, occurred_at)
  VALUES (opened, deposit.creditor_id, 'CASE_DEPOSITED', 'Créance déposée par le créancier', 'info', 'CREDITOR', deposit.deposited_by, 'créancier', true,
    deposit.created_at);
  INSERT INTO public.case_events (case_id, creditor_id, kind, title, tone, actor_kind, actor_id, actor_label, on_behalf_of_id, visible_to_creditor)
  VALUES (opened, deposit.creditor_id, 'DEPOSIT_ACCEPTED', 'Dossier ouvert par le cabinet', 'success', app.actor_kind(), app.actor_id(), app.actor_label(),
    app.on_behalf_of(), true);
  -- For the team only: the name to check against the register, and whether it is that of the debtor already known.
  INSERT INTO public.case_events (case_id, creditor_id, kind, title, detail, tone, actor_kind, actor_label, visible_to_creditor)
  SELECT opened, deposit.creditor_id, 'DEPOSITED_NAME', 'Raison sociale donnée par le créancier, à vérifier',
    CASE WHEN d.name_confirmed AND app.plain_name(d.name) <> app.plain_name(deposit.debtor_name) THEN 'Différente de celle déjà connue pour ce SIREN : ' ELSE '' END
      || deposit.debtor_name,
    'warning', 'SYSTEM', 'automatique', false
  FROM public.debtors d WHERE d.id = debtor;
  UPDATE public.claim_deposits k SET status = 'ACCEPTED', opened_case = opened, decided_by = app.user_id(), on_behalf_of_id = app.on_behalf_of(), decided_at = now(),
    debtor_name = NULL, siret = NULL, address = NULL, email = NULL, phone = NULL, invoices = NULL, files = '{}'
  WHERE k.id = target;
  PERFORM app.log('DEPOSIT_ACCEPTED', 'case', opened, '{}'::jsonb);
  outcome := 'OPENED';
END
$$;

-- Refused by the Director or the manager, with a reason: kept 30 days, what the creditor gave is emptied at once. Its files,
-- without a case, go with the others (app.forget_waiting_files). Outcome: REFUSED, CHANGED; NULL when there is no such deposit.
CREATE FUNCTION app.refuse_deposit(target uuid, why text) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  deposit public.claim_deposits%ROWTYPE;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'STAFF' OR app.staff_role() IS NULL OR app.staff_role() NOT IN ('DIRECTOR', 'COLLECTION_MANAGER') THEN
    PERFORM app.refuse('42501');
  END IF;
  SELECT * INTO deposit FROM public.claim_deposits k WHERE k.id = target FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF deposit.status <> 'PENDING' THEN
    RETURN 'CHANGED';
  END IF;
  UPDATE public.claim_deposits k SET status = 'REFUSED', reason = btrim(why), decided_by = app.user_id(), on_behalf_of_id = app.on_behalf_of(), decided_at = now(),
    debtor_name = NULL, siret = NULL, address = NULL, email = NULL, phone = NULL, invoices = NULL, files = '{}'
  WHERE k.id = target AND k.status = 'PENDING';
  IF NOT FOUND THEN
    RETURN 'CHANGED';
  END IF;
  PERFORM app.log('DEPOSIT_REFUSED', 'claim_deposit', target, '{}'::jsonb);
  RETURN 'REFUSED';
END
$$;
REVOKE ALL ON FUNCTION app.accept_deposit(uuid, bigint), app.refuse_deposit(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.accept_deposit(uuid, bigint), app.refuse_deposit(uuid, text) TO legarec_staff;
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM legarec_definer;

-- ---------------------------------------------------------------- The files of a creditor that no case took

-- Every night, by the retention: a file of a creditor still without a case 30 days after it was sent (never deposited, or
-- its deposit refused) is purged, unless a deposit waiting for the team holds it; its storage goes with the purge of files.
GRANT SELECT (source, uploaded_by_creditor, created_at) ON documents TO legarec_forgetter;
GRANT SELECT (files, status) ON claim_deposits TO legarec_forgetter;
CREATE POLICY forgetter_read ON claim_deposits FOR SELECT TO legarec_forgetter USING (true);
GRANT CREATE ON SCHEMA app TO legarec_forgetter;
SET LOCAL ROLE legarec_forgetter;
CREATE FUNCTION app.forget_waiting_files() RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  removed integer;
BEGIN
  UPDATE public.documents d SET title = 'Pièce supprimée', original_name = 'piece-supprimee', purged_at = now()
  WHERE d.source = 'CREDITOR' AND d.case_id IS NULL AND d.purged_at IS NULL AND d.created_at < now() - interval '30 days'
    AND NOT EXISTS (SELECT 1 FROM public.claim_deposits k WHERE k.status = 'PENDING' AND d.id = ANY (k.files));
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END
$$;
REVOKE ALL ON FUNCTION app.forget_waiting_files() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.forget_waiting_files() TO legarec_definer;
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM legarec_forgetter;
-- Called by the retention through the definer, as the other purges (app.purge_invoices…).
GRANT CREATE ON SCHEMA app TO legarec_definer;
SET LOCAL ROLE legarec_definer;
CREATE FUNCTION app.purge_waiting_files() RETURNS integer
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT app.forget_waiting_files()
$$;
REVOKE ALL ON FUNCTION app.purge_waiting_files() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.purge_waiting_files() TO legarec_retention;
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM legarec_definer;
