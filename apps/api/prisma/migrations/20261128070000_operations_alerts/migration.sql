-- What the night or the clock finds wrong on the server, told in the application to the Developer (Gatus was removed on
-- 28/11/2026, question 231): the sweep of the files that found a file without a row, or stopped; clamd that no longer
-- answers. One a day for each, whatever calls it. Neither a name, nor a key, nor a count: the journal of the worker has them.
ALTER TYPE notification_kind ADD VALUE 'FILES_SWEEP';
ALTER TYPE notification_kind ADD VALUE 'ANTIVIRUS_DOWN';

GRANT CREATE ON SCHEMA app TO legarec_definer;
SET LOCAL ROLE legarec_definer;

CREATE FUNCTION app.operations_alert(wanted text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'SYSTEM' OR wanted IS NULL OR wanted NOT IN ('FILES_SWEEP', 'ANTIVIRUS_DOWN') THEN
    PERFORM app.refuse('42501');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('operations-alert:' || wanted, 0));
  IF EXISTS (SELECT 1 FROM public.notifications n WHERE n.kind::text = wanted AND n.created_at > now() - interval '1 day') THEN
    RETURN false;
  END IF;
  INSERT INTO public.notifications (user_id, kind, actor_id, target_id)
  SELECT u.id, wanted::public.notification_kind, u.id, u.id FROM public.users u WHERE u.role = 'DEVELOPER' AND u.status = 'ACTIVE';
  RETURN FOUND;
END
$$;

GRANT EXECUTE ON FUNCTION app.operations_alert(text) TO legarec_worker, legarec_retention;
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM legarec_definer;
CREATE POLICY definer_read_operations_alert ON notifications FOR SELECT TO legarec_definer USING (kind::text IN ('FILES_SWEEP', 'ANTIVIRUS_DOWN'));
