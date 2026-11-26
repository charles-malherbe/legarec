-- The alert at 80 % of the budget of the assistant (docs/ia.md): told to the Director, once a month.

ALTER TYPE notification_kind ADD VALUE 'AI_BUDGET';

GRANT CREATE ON SCHEMA app TO legarec_definer;
GRANT SELECT (user_id, kind, created_at) ON notifications TO legarec_definer;
SET LOCAL ROLE legarec_definer;
CREATE FUNCTION app.ai_budget_alert(budget_micro bigint) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  director uuid := app.director_id();
  month_start timestamptz := date_trunc('month', now() AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris';
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'SYSTEM' THEN
    PERFORM app.refuse('42501');
  END IF;
  IF director IS NULL OR app.ai_spent() * 10 < budget_micro * 8 THEN
    RETURN;
  END IF;
  -- One a month, the same for whoever crosses it.
  PERFORM pg_advisory_xact_lock(hashtextextended('ai-budget-alert', 0));
  IF EXISTS (SELECT 1 FROM public.notifications n WHERE n.user_id = director AND n.kind::text = 'AI_BUDGET' AND n.created_at >= month_start) THEN
    RETURN;
  END IF;
  INSERT INTO public.notifications (user_id, kind, actor_id, target_id) VALUES (director, 'AI_BUDGET'::text::notification_kind, director, director);
END
$$;
GRANT EXECUTE ON FUNCTION app.ai_budget_alert(bigint) TO legarec_worker;
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM legarec_definer;
CREATE POLICY definer_read_ai_budget ON notifications FOR SELECT TO legarec_definer USING (kind::text = 'AI_BUDGET');
