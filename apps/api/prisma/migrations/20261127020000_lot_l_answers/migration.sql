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
-- drawn and renewed only from an open case (app.first_access_code, app.renew_access_code), and never for a forgotten debtor.
GRANT CREATE ON SCHEMA app TO legarec_definer;
SET LOCAL ROLE legarec_definer;
CREATE OR REPLACE FUNCTION app.access_code(target uuid) RETURNS TABLE (debtor_id uuid, code_cipher bytea, version integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT a.debtor_id, a.code_cipher, a.version FROM public.cases c JOIN public.debtor_access_codes a ON a.debtor_id = c.debtor_id
    JOIN public.debtors d ON d.id = c.debtor_id
  WHERE c.id = target AND d.anonymized_at IS NULL AND app.can_act_on_case(c.officer_id)
$$;
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM legarec_definer;

-- ---------------------------------------------------------------- Question 141: « Accès refusé » for a case of someone else

-- Whether a case exists, nothing more, and to the team alone: a creditor or a debtor is never told (they are not granted it,
-- and app.staff_role() is null for them).
GRANT CREATE ON SCHEMA app TO legarec_definer;
SET LOCAL ROLE legarec_definer;
CREATE FUNCTION app.case_exists(target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT app.staff_role() IS NOT NULL AND EXISTS (SELECT 1 FROM public.cases c WHERE c.id = target)
$$;
REVOKE ALL ON FUNCTION app.case_exists(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.case_exists(uuid) TO legarec_staff;
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM legarec_definer;
