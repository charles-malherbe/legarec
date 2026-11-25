-- Notifications about cases: facts only, read again with the rights of their reader.

ALTER TYPE notification_kind ADD VALUE 'CASE_ASSIGNED';
ALTER TYPE notification_kind ADD VALUE 'SUBSTITUTE_NOTICE';
ALTER TABLE notifications
  ADD COLUMN case_id uuid,
  ADD COLUMN creditor_id uuid,
  ADD COLUMN case_count integer,
  DROP CONSTRAINT notifications_facts,
  ADD CONSTRAINT notifications_facts CHECK (
    actor_id IS NOT NULL AND CASE kind::text
      WHEN 'SUPPORT_ACTION' THEN action IS NOT NULL AND target_id IS NOT NULL
      WHEN 'SUPPORT_TICKET' THEN ticket_id IS NOT NULL
      -- One case, or how many of them.
      WHEN 'CASE_ASSIGNED' THEN case_count > 0 AND (case_count = 1) = (case_id IS NOT NULL)
      -- Neutral (question 91): the colleague who is away, never a case.
      WHEN 'SUBSTITUTE_NOTICE' THEN target_id IS NOT NULL AND case_count > 0
      ELSE target_id IS NOT NULL
    END),
  ADD CONSTRAINT notifications_case CHECK (case_id IS NULL OR (creditor_id IS NOT NULL AND kind::text = 'CASE_ASSIGNED')),
  ADD FOREIGN KEY (case_id, creditor_id) REFERENCES cases (id, creditor_id);

GRANT CREATE ON SCHEMA app TO legarec_definer;
GRANT INSERT (case_id, creditor_id, case_count) ON notifications TO legarec_definer;
GRANT SELECT (absent_from, absent_until) ON users TO legarec_definer;
SET LOCAL ROLE legarec_definer;
-- As before, and told to whoever receives the cases; if they are away, to their substitute, who learns nothing of the cases.
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
  IF cardinality(changed) > 0 AND officer <> app.user_id() THEN
    INSERT INTO public.notifications (user_id, kind, actor_id, case_id, creditor_id, case_count)
    SELECT officer, 'CASE_ASSIGNED', app.user_id(), c.id, c.creditor_id, cardinality(changed)
    FROM (VALUES (1)) AS one LEFT JOIN public.cases c ON cardinality(changed) = 1 AND c.id = changed[1];
    INSERT INTO public.notifications (user_id, kind, actor_id, target_id, case_count)
    SELECT s.id, 'SUBSTITUTE_NOTICE', app.user_id(), officer, cardinality(changed)
    FROM public.users a JOIN public.users s ON s.id = a.substitute_id
    WHERE a.id = officer AND (now() AT TIME ZONE 'Europe/Paris')::date BETWEEN a.absent_from AND a.absent_until
      AND s.id <> app.user_id() AND s.status = 'ACTIVE' AND s.role IN ('DIRECTOR', 'COLLECTION_MANAGER', 'CLAIMS_OFFICER');
  END IF;
  RETURN cardinality(changed);
END
$$;
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM legarec_definer;
GRANT SELECT (case_id, creditor_id, case_count) ON notifications TO legarec_staff;
