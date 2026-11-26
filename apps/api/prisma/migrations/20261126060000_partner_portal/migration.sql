-- Portal of the creditors: what they read of their cases is already limited by PostgreSQL (`partner_read` policies); here,
-- their agreement on a long payment plan (question 86), after the manager and before the debtor.

GRANT CREATE ON SCHEMA app TO legarec_definer;
SET LOCAL ROLE legarec_definer;
-- The creditor of the session agrees, or refuses with a reason, on a plan of one of its cases that waits for it. Told to whoever
-- asked for the plan, and written in the history the creditor reads.
CREATE FUNCTION app.creditor_decide_plan(target uuid, accepted boolean, why text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  plan record;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'CREDITOR' OR app.partner_creditor() IS NULL THEN
    PERFORM app.refuse('42501');
  END IF;
  SELECT p.id, p.case_id, p.creditor_id, p.status, p.requested_by, p.months INTO plan
  FROM public.payment_plans p WHERE p.id = target AND p.creditor_id = app.partner_creditor()
  FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app.refuse('LG404');
  END IF;
  IF plan.status <> 'WAITING_CREDITOR' THEN
    PERFORM app.refuse('LG409');
  END IF;
  IF NOT accepted AND coalesce(btrim(why), '') = '' THEN
    PERFORM app.refuse('22023');
  END IF;
  UPDATE public.plan_approvals a SET decision = CASE WHEN accepted THEN 'APPROVED' ELSE 'REFUSED' END::plan_decision, decided_by = app.user_id(),
    reason = nullif(btrim(why), ''), decided_at = now()
  WHERE a.plan_id = target AND a.step = 'CREDITOR' AND a.decision = 'PENDING';
  IF NOT FOUND THEN
    PERFORM app.refuse('LG409');
  END IF;
  UPDATE public.payment_plans p SET status = CASE WHEN accepted THEN 'WAITING_DEBTOR' ELSE 'REFUSED' END::plan_status, version = p.version + 1 WHERE p.id = target;
  INSERT INTO public.case_events (case_id, creditor_id, kind, title, tone, actor_kind, actor_id, actor_label, visible_to_creditor)
  VALUES (plan.case_id, plan.creditor_id, 'PLAN_CREDITOR_DECIDED', CASE WHEN accepted THEN 'Échéancier accepté par le créancier' ELSE 'Échéancier refusé par le créancier' END,
    CASE WHEN accepted THEN 'success' ELSE 'warning' END::event_tone, 'CREDITOR', app.user_id(), 'créancier', true);
  INSERT INTO public.notifications (user_id, kind, actor_id, target_id, plan_id, plan_decision, case_id, creditor_id, case_count)
  VALUES (plan.requested_by, 'PLAN_DECIDED', app.user_id(), plan.requested_by, target, CASE WHEN accepted THEN 'APPROVED' ELSE 'REFUSED' END::plan_decision,
    plan.case_id, plan.creditor_id, 1);
  PERFORM app.log(CASE WHEN accepted THEN 'PLAN_CREDITOR_APPROVED' ELSE 'PLAN_CREDITOR_REFUSED' END, 'case', plan.case_id, jsonb_build_object('months', least(plan.months, 999)));
END
$$;
GRANT EXECUTE ON FUNCTION app.creditor_decide_plan(uuid, boolean, text) TO legarec_partner;
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM legarec_definer;

-- What the creditor reads of a plan to decide on it: the steps already decided, and when it was asked.
GRANT SELECT (created_at, threshold_months) ON payment_plans TO legarec_partner;
