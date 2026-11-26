-- A claim deposited by a creditor in its portal opens a case held by nobody, under its mandate in force: the manager takes it.
-- Its files wait for its claim as those of a debtor wait for their message. The debtor is told nothing before the first letter.

ALTER TABLE documents ADD COLUMN uploaded_by_creditor uuid REFERENCES creditors (id),
  DROP CONSTRAINT documents_debtor_upload,
  ADD CONSTRAINT documents_outside_upload CHECK (
    (source = 'DEBTOR') = (uploaded_by_debtor IS NOT NULL) AND (source = 'CREDITOR') = (uploaded_by_creditor IS NOT NULL));

-- What a creditor writes of a debtor is never taken on trust: the name it gives stays on its case; a debtor it is the first to
-- name keeps that name only until the team opens a case for it under the confirmed name.
ALTER TABLE debtors ADD COLUMN name_confirmed boolean NOT NULL DEFAULT true;
ALTER TABLE cases ADD COLUMN deposited_name text CHECK (length(btrim(deposited_name)) BETWEEN 1 AND 150);
GRANT SELECT (name_confirmed) ON debtors TO legarec_staff, legarec_worker;
GRANT SELECT (deposited_name) ON cases TO legarec_staff, legarec_worker, legarec_partner;

GRANT CREATE ON SCHEMA app TO legarec_definer;
GRANT SELECT (name_confirmed), INSERT (name_confirmed), UPDATE (name, name_confirmed) ON debtors TO legarec_definer;
GRANT SELECT (id, creditor_id, starts_on, ends_on, scenario) ON mandates TO legarec_definer;
GRANT SELECT (creditor_id, kind, occurred_at) ON case_events TO legarec_definer;
GRANT INSERT (id, reference, creditor_id, debtor_id, status, mandate_id, debtor_siret, debtor_address, scenario, deposited_name) ON cases TO legarec_definer;
GRANT INSERT (case_id, creditor_id, number, issued_on, due_on, claimed_cents, principal_cents) ON case_invoices TO legarec_definer;
GRANT INSERT (case_id, creditor_id, kind, label, value, value_normalized, status, is_primary, source) ON case_contacts TO legarec_definer;
GRANT SELECT (uploaded_by_creditor), INSERT (uploaded_by_creditor) ON documents TO legarec_definer;
SET LOCAL ROLE legarec_definer;

-- A file of the creditor, waiting for its claim.
CREATE FUNCTION app.creditor_upload(wanted_id uuid, wanted_kind document_kind, wanted_key text, size integer, fingerprint text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'CREDITOR' OR app.partner_creditor() IS NULL THEN
    PERFORM app.refuse('42501');
  END IF;
  IF (SELECT count(*) FROM public.documents d WHERE d.uploaded_by_creditor = app.partner_creditor() AND d.case_id IS NULL) >= 50 THEN
    PERFORM app.refuse('LG409');
  END IF;
  INSERT INTO public.documents (id, category, kind, title, original_name, storage_key, size_bytes, sha256, source, uploaded_by_creditor)
  VALUES (wanted_id, 'INVOICE', wanted_kind, 'Pièce déposée par le créancier', 'piece-du-creancier.' || lower(wanted_kind::text), wanted_key, size, fingerprint, 'CREDITOR',
    app.partner_creditor());
END
$$;

-- The deposit itself. `outcome`: OPENED, NO_MANDATE, CASE_EXISTS (a case of this creditor is open for that debtor), FILES
-- (files that are not its own, waiting), TOO_MANY (more than 500 a day). Whether the SIREN was known is never told: the case
-- opens alike, with the name the creditor gave kept on it, and the history tells the team to check it.
CREATE FUNCTION app.creditor_deposit(wanted_name text, siret text, address text, email text, phone text, invoices jsonb, files uuid[],
  OUT outcome text, OUT opened uuid, OUT ref text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  holder uuid := app.partner_creditor();
  mandate record;
  wanted_siren text := CASE WHEN coalesce(siret, '') <> '' THEN left(siret, 9) END;
  debtor uuid;
  this_year integer := extract(year FROM now() AT TIME ZONE 'Europe/Paris');
  taken integer;
  drawn integer;
  today date := (now() AT TIME ZONE 'Europe/Paris')::date;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'CREDITOR' OR holder IS NULL OR jsonb_typeof(invoices) <> 'array' OR jsonb_array_length(invoices) NOT BETWEEN 1 AND 50 THEN
    PERFORM app.refuse('42501');
  END IF;
  IF cardinality(coalesce(files, '{}')) > 20 OR (SELECT count(*) FROM public.documents d WHERE d.id = ANY (coalesce(files, '{}')) AND d.uploaded_by_creditor = holder
      AND d.case_id IS NULL) <> cardinality(coalesce(files, '{}')) THEN
    outcome := 'FILES';
    RETURN;
  END IF;
  SELECT m.id, m.scenario INTO mandate FROM public.mandates m
  WHERE m.creditor_id = holder AND m.starts_on <= today AND (m.ends_on IS NULL OR m.ends_on >= today) ORDER BY m.starts_on DESC LIMIT 1;
  IF NOT FOUND THEN
    outcome := 'NO_MANDATE';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM public.case_events e WHERE e.creditor_id = holder AND e.kind = 'CASE_DEPOSITED' AND e.occurred_at > now() - interval '1 day') >= 500 THEN
    outcome := 'TOO_MANY';
    RETURN;
  END IF;
  IF wanted_siren IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('debtor:' || wanted_siren, 0));
    SELECT d.id INTO debtor FROM public.debtors d WHERE d.siren = wanted_siren;
  END IF;
  IF debtor IS NULL THEN
    debtor := app.uuid_v7();
    INSERT INTO public.debtors (id, kind, name, siren, name_confirmed)
    VALUES (debtor, CASE WHEN wanted_siren IS NULL THEN 'INDIVIDUAL' ELSE 'COMPANY' END::debtor_kind, btrim(wanted_name), wanted_siren, false);
  END IF;
  IF EXISTS (SELECT 1 FROM public.cases c WHERE c.creditor_id = holder AND c.debtor_id = debtor AND c.closed_on IS NULL) THEN
    outcome := 'CASE_EXISTS';
    RETURN;
  END IF;
  INSERT INTO public.number_sequences AS s (kind, year, last_value) VALUES ('CASE', this_year, 1)
  ON CONFLICT (kind, year) DO UPDATE SET last_value = s.last_value + 1 RETURNING last_value INTO drawn;
  opened := app.uuid_v7();
  ref := format('LGR-%s-%s', this_year, lpad(drawn::text, 5, '0'));
  INSERT INTO public.cases (id, reference, creditor_id, debtor_id, status, mandate_id, debtor_siret, debtor_address, scenario, deposited_name)
  VALUES (opened, ref, holder, debtor, 'NEW', mandate.id, nullif(siret, ''), btrim(address), mandate.scenario, btrim(wanted_name));
  INSERT INTO public.case_invoices (case_id, creditor_id, number, issued_on, due_on, claimed_cents, principal_cents)
  SELECT opened, holder, btrim(line ->> 'number'), (line ->> 'issuedOn')::date, (line ->> 'dueOn')::date, (line ->> 'amount')::integer, (line ->> 'amount')::integer
  FROM jsonb_array_elements(invoices) AS line;
  -- What the creditor gives is neither verified nor used to send the access code (question 112).
  IF coalesce(email, '') <> '' THEN
    INSERT INTO public.case_contacts (case_id, creditor_id, kind, label, value, value_normalized, status, is_primary, source)
    VALUES (opened, holder, 'EMAIL', 'Fournie par le créancier', btrim(email), lower(btrim(email)), 'UNVERIFIED', true, 'CREDITOR');
  END IF;
  IF length(regexp_replace(coalesce(phone, ''), '\D', '', 'g')) >= 3 THEN
    INSERT INTO public.case_contacts (case_id, creditor_id, kind, label, value, value_normalized, status, is_primary, source)
    VALUES (opened, holder, 'PHONE', 'Fourni par le créancier', btrim(phone),
      regexp_replace(regexp_replace(phone, '\D', '', 'g'), '^33(?=[1-9])', '0'), 'UNVERIFIED', true, 'CREDITOR');
  END IF;
  UPDATE public.documents d SET case_id = opened, creditor_id = holder
  WHERE d.id = ANY (coalesce(files, '{}')) AND d.case_id IS NULL AND d.uploaded_by_creditor = holder;
  GET DIAGNOSTICS taken = ROW_COUNT;
  IF taken <> cardinality(coalesce(files, '{}')) THEN
    PERFORM app.refuse('LG409');
  END IF;
  INSERT INTO public.case_events (case_id, creditor_id, kind, title, tone, actor_kind, actor_id, actor_label, visible_to_creditor)
  VALUES (opened, holder, 'CASE_DEPOSITED', 'Créance déposée par le créancier', 'info', 'CREDITOR', app.user_id(), 'créancier', true);
  -- For the team only: the name to check against the register, and whether it is that of the debtor already known.
  INSERT INTO public.case_events (case_id, creditor_id, kind, title, detail, tone, actor_kind, actor_label, visible_to_creditor)
  SELECT opened, holder, 'DEPOSITED_NAME', 'Raison sociale donnée par le créancier, à vérifier',
    CASE WHEN d.name_confirmed AND app.plain_name(d.name) <> app.plain_name(wanted_name) THEN 'Différente de celle déjà connue pour ce SIREN : ' ELSE '' END || btrim(wanted_name),
    'warning', 'SYSTEM', 'automatique', false
  FROM public.debtors d WHERE d.id = debtor;
  PERFORM app.log('CASE_DEPOSITED', 'case', opened, jsonb_build_object('count', least(jsonb_array_length(invoices), 999)));
  outcome := 'OPENED';
END
$$;
GRANT EXECUTE ON FUNCTION app.creditor_upload(uuid, document_kind, text, integer, text),
  app.creditor_deposit(text, text, text, text, text, jsonb, uuid[]) TO legarec_partner;
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM legarec_definer;

CREATE POLICY definer_deposit ON cases FOR INSERT TO legarec_definer WITH CHECK (status = 'NEW' AND officer_id IS NULL AND creditor_id = (SELECT app.partner_creditor()));
CREATE POLICY definer_deposit ON case_invoices FOR INSERT TO legarec_definer WITH CHECK (creditor_id = (SELECT app.partner_creditor()));
CREATE POLICY definer_deposit ON case_contacts FOR INSERT TO legarec_definer WITH CHECK (source = 'CREDITOR' AND status = 'UNVERIFIED' AND creditor_id = (SELECT app.partner_creditor()));
CREATE POLICY definer_deposit ON mandates FOR SELECT TO legarec_definer USING (true);
-- The files of a creditor waiting for its claim are its own; the team sees none of them before.
CREATE POLICY partner_own ON documents FOR SELECT TO legarec_partner USING (uploaded_by_creditor = (SELECT app.partner_creditor()) AND case_id IS NULL);
CREATE POLICY staff_not_waiting_creditor ON documents AS RESTRICTIVE FOR SELECT TO legarec_staff USING (uploaded_by_creditor IS NULL OR case_id IS NOT NULL);
GRANT SELECT (uploaded_by_creditor) ON documents TO legarec_staff, legarec_worker;

-- The team opens a case under the name it confirmed: a debtor first named by a creditor takes it (question 155).
CREATE POLICY definer_confirm ON debtors FOR UPDATE TO legarec_definer USING (NOT name_confirmed) WITH CHECK (name_confirmed);
GRANT CREATE ON SCHEMA app TO legarec_definer;
SET LOCAL ROLE legarec_definer;
CREATE OR REPLACE FUNCTION app.open_debtor(wanted_kind debtor_kind, wanted_name text, wanted_siren text, form_code text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  known uuid;
BEGIN
  IF app.staff_role() IS NULL OR app.staff_role() NOT IN ('DIRECTOR', 'COLLECTION_MANAGER') OR (wanted_kind = 'INDIVIDUAL') <> (wanted_siren IS NULL) THEN
    PERFORM app.refuse('42501');
  END IF;
  IF wanted_siren IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('debtor:' || wanted_siren, 0));
    SELECT d.id INTO known FROM public.debtors d WHERE d.siren = wanted_siren;
    IF FOUND THEN
      UPDATE public.debtors d SET name = btrim(wanted_name), kind = wanted_kind, name_confirmed = true WHERE d.id = known AND NOT d.name_confirmed;
      RETURN (SELECT d.id FROM public.debtors d WHERE d.id = known AND d.kind = wanted_kind AND app.plain_name(d.name) = app.plain_name(wanted_name));
    END IF;
  END IF;
  known := app.uuid_v7();
  INSERT INTO public.debtors (id, kind, name, siren, legal_form_code, legal_form_source, legal_form_checked_at)
  VALUES (known, wanted_kind, wanted_name, wanted_siren, form_code, CASE WHEN form_code IS NOT NULL THEN 'STAFF' END, CASE WHEN form_code IS NOT NULL THEN now() END);
  RETURN known;
END
$$;
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM legarec_definer;
GRANT UPDATE (kind) ON debtors TO legarec_definer;
