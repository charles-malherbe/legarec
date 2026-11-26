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
