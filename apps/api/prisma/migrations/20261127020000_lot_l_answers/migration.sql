-- Answers of the firm to questions 138, 140, 141 and 142 (DECISIONS.md, 26/11/2026).

-- ---------------------------------------------------------------- Question 142: an account typed by one, confirmed by another

-- Typed unconfirmed: the confirmation is a call made by someone else.
DROP POLICY staff_add ON creditor_bank_accounts;
CREATE POLICY staff_add ON creditor_bank_accounts FOR INSERT TO legarec_staff WITH CHECK (
  (SELECT app.acts_as_director('ADMINISTRATIVE')) AND created_by = (SELECT app.user_id()) AND confirmed_by IS NULL
  AND on_behalf_of_id IS NOT DISTINCT FROM (SELECT app.on_behalf_of()));

-- Closed for good; confirmed once, by whoever made the call, who is not whoever typed it.
CREATE OR REPLACE FUNCTION app.keep_account_history() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF OLD.valid_until IS NOT NULL OR NEW.valid_until > clock_timestamp() + interval '1 minute'
    OR ((NEW.confirmed_by, NEW.confirmed_at, NEW.confirmed_with) IS DISTINCT FROM (OLD.confirmed_by, OLD.confirmed_at, OLD.confirmed_with)
      AND (OLD.confirmed_by IS NOT NULL OR NEW.confirmed_by IS DISTINCT FROM app.user_id())) THEN
    RAISE EXCEPTION 'account history kept' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.confirmed_by IS NULL AND NEW.confirmed_by IS NOT NULL AND NEW.confirmed_by = OLD.created_by THEN
    RAISE EXCEPTION 'account confirmed by its author' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;

-- ---------------------------------------------------------------- Question 140: the access code of a closed case, read only

-- Of the debtor of a case, for whoever acts on that case, closed or not: the code opens all the cases of the debtor. It is
-- drawn and renewed only from an open case (app.first_access_code, app.renew_access_code), and never shown from a forgotten
-- case nor for a forgotten debtor.
GRANT CREATE ON SCHEMA app TO legarec_definer;
SET LOCAL ROLE legarec_definer;
CREATE OR REPLACE FUNCTION app.access_code(target uuid) RETURNS TABLE (debtor_id uuid, code_cipher bytea, version integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT a.debtor_id, a.code_cipher, a.version FROM public.cases c JOIN public.debtor_access_codes a ON a.debtor_id = c.debtor_id
    JOIN public.debtors d ON d.id = c.debtor_id
  WHERE c.id = target AND c.anonymized_at IS NULL AND d.anonymized_at IS NULL AND app.can_act_on_case(c.officer_id)
$$;
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM legarec_definer;

-- ---------------------------------------------------------------- Question 141: « Accès refusé » for a case of someone else

-- Whether a case exists, nothing more, and to the roles that hold cases alone: a creditor, a debtor or the Developer is
-- never told (the first two are not granted it; app.staff_role() says who the others are).
GRANT CREATE ON SCHEMA app TO legarec_definer;
SET LOCAL ROLE legarec_definer;
CREATE FUNCTION app.case_exists(target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT coalesce(app.staff_role() IN ('DIRECTOR', 'COLLECTION_MANAGER', 'CLAIMS_OFFICER'), false) AND EXISTS (SELECT 1 FROM public.cases c WHERE c.id = target)
$$;
REVOKE ALL ON FUNCTION app.case_exists(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.case_exists(uuid) TO legarec_staff;
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM legarec_definer;

-- ---------------------------------------------------------------- Question 138: the name and the kind of a debtor, corrected

-- By the Director and the manager, from a case of the debtor they act on (the Director changes nothing from a case of someone
-- else): the name changes in all its cases, for all the creditors. The SIREN never changes; a debtor with one is never an
-- individual (debtors_individual). The functions of the definer that change a debtor are listed by test/schema.test.ts.
CREATE POLICY definer_correct ON debtors FOR UPDATE TO legarec_definer
  USING ((SELECT app.staff_role()) IN ('DIRECTOR', 'COLLECTION_MANAGER') AND anonymized_at IS NULL
    AND EXISTS (SELECT 1 FROM cases c WHERE c.debtor_id = debtors.id AND c.anonymized_at IS NULL AND app.can_act_on_case(c.officer_id)))
  WITH CHECK (name_confirmed AND anonymized_at IS NULL);

GRANT CREATE ON SCHEMA app TO legarec_definer;
SET LOCAL ROLE legarec_definer;
-- `seen`: the name that was on the screen. NULL when the case is not read; 'CHANGED' when the debtor changed since. Each case
-- of the debtor not forgotten notes it, kept from the creditor: by its author in the case it was done from, by « Legarec »
-- elsewhere (whoever follows another case learns that the name changed, not who did it).
CREATE FUNCTION app.correct_debtor(target uuid, wanted_kind debtor_kind, wanted_name text, seen text) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  known uuid;
  number text;
  may boolean;
  current text;
  forgotten timestamptz;
BEGIN
  IF app.staff_role() IS NULL OR app.staff_role() NOT IN ('DIRECTOR', 'COLLECTION_MANAGER') THEN
    PERFORM app.refuse('42501');
  END IF;
  SELECT d.id, d.siren, app.can_act_on_case(c.officer_id) AND c.anonymized_at IS NULL INTO known, number, may
  FROM public.cases c JOIN public.debtors d ON d.id = c.debtor_id
  WHERE c.id = target AND app.can_read_case(c.officer_id);
  IF known IS NULL THEN
    RETURN NULL;
  END IF;
  IF NOT may THEN
    PERFORM app.refuse('42501');
  END IF;
  -- As at the opening of a case with this SIREN.
  IF number IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('debtor:' || number, 0));
  END IF;
  SELECT d.name, d.anonymized_at INTO current, forgotten FROM public.debtors d WHERE d.id = known FOR UPDATE;
  IF forgotten IS NOT NULL OR current IS DISTINCT FROM seen THEN
    RETURN 'CHANGED';
  END IF;
  UPDATE public.debtors d SET name = btrim(wanted_name), kind = wanted_kind, name_confirmed = true WHERE d.id = known;
  IF NOT FOUND THEN
    RETURN 'CHANGED';
  END IF;
  INSERT INTO public.case_events (case_id, creditor_id, kind, title, detail, tone, actor_kind, actor_id, actor_label, on_behalf_of_id)
  SELECT c.id, c.creditor_id, 'DEBTOR_CORRECTED', 'Débiteur corrigé', 'Ancien nom : ' || current, 'info',
    CASE WHEN c.id = target THEN app.actor_kind() ELSE 'SYSTEM' END, CASE WHEN c.id = target THEN app.actor_id() END,
    CASE WHEN c.id = target THEN app.actor_label() ELSE 'Legarec' END, CASE WHEN c.id = target THEN app.on_behalf_of() END
  FROM public.cases c WHERE c.debtor_id = known AND c.anonymized_at IS NULL;
  RETURN 'DONE';
END
$$;
REVOKE ALL ON FUNCTION app.correct_debtor(uuid, debtor_kind, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.correct_debtor(uuid, debtor_kind, text, text) TO legarec_staff;
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM legarec_definer;
