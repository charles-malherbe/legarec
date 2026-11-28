-- The last cases a person opened, the latest first (DECISIONS.md, 28/11/2026): offered under the search box of the espace
-- before anything is typed. Ids only, five at most, in the account itself. What someone looked at is nobody else's
-- business: the team reads the accounts of the others (policy staff_read), so it is given no right on this column, and
-- two functions read and write one's own list. A case closed to the person since, or anonymized, is left out when the
-- list is read, by the policies of the cases (CasesService.recent).
ALTER TABLE users
  ADD COLUMN recent_case_ids uuid[] NOT NULL DEFAULT '{}',
  ADD CONSTRAINT users_recent_case_ids CHECK (cardinality(recent_case_ids) <= 5);

GRANT SELECT (recent_case_ids), UPDATE (recent_case_ids) ON users TO legarec_definer;
GRANT CREATE ON SCHEMA app TO legarec_definer;
SET LOCAL ROLE legarec_definer;
-- One's own list, nothing about the cases: the API reads them with the rights of the person.
CREATE FUNCTION app.recent_cases() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT coalesce((SELECT u.recent_case_ids FROM public.users u WHERE u.id = app.user_id() AND app.staff_role() IS NOT NULL), '{}');
$$;
-- The case opened goes first and the sixth falls off; only a case the person may read, and not anonymized.
CREATE FUNCTION app.note_recent_case(target uuid) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  UPDATE public.users u SET recent_case_ids = (array_prepend(target, array_remove(u.recent_case_ids, target)))[1:5]
  WHERE u.id = app.user_id() AND app.staff_role() IS NOT NULL
    -- Already first, as after a reload: nothing to write.
    AND u.recent_case_ids[1] IS DISTINCT FROM target
    AND EXISTS (SELECT 1 FROM public.cases c WHERE c.id = target AND c.anonymized_at IS NULL AND app.can_read_case(c.officer_id));
$$;
-- Whoever leaves or changes role starts again from an empty list: the former one followed other rights.
CREATE OR REPLACE FUNCTION app.close_account(target uuid) RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  UPDATE public.user_sessions SET revoked_at = now() WHERE user_id = target AND revoked_at IS NULL;
  UPDATE public.auth_tokens SET used_at = now() WHERE user_id = target AND used_at IS NULL;
  DELETE FROM public.user_devices WHERE user_id = target;
  UPDATE public.users SET recent_case_ids = '{}' WHERE id = target AND recent_case_ids <> '{}';
$$;
REVOKE ALL ON FUNCTION app.recent_cases(), app.note_recent_case(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.recent_cases(), app.note_recent_case(uuid) TO legarec_staff;
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM legarec_definer;
