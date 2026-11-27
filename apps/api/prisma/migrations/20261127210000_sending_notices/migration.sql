-- A reminder that has not left (refused, failed, expired) is told to the colleague who asked for it, in the application
-- (lot Q): until now only the history of the case said it. One notification per line, written by the worker with the
-- failure, in its transaction. Neither an address nor the reason: the case, as the other notifications of a case.

ALTER TYPE notification_kind ADD VALUE 'SENDING_FAILED';
ALTER TABLE notifications DROP CONSTRAINT notifications_case,
  ADD CONSTRAINT notifications_case CHECK (case_id IS NULL OR (creditor_id IS NOT NULL AND kind::text IN ('CASE_ASSIGNED', 'PLAN_DECIDED', 'DEBTOR_BLOCKED', 'SENDING_FAILED')));

GRANT CREATE ON SCHEMA app TO legarec_definer;
GRANT SELECT (creditor_id, created_by) ON sendings TO legarec_definer;
SET LOCAL ROLE legarec_definer;
-- For the worker alone, about a line that has failed. Nobody is told when the colleague has left the firm, nor about a
-- case that has been anonymized since. Whether they still read the case is decided when the notification is read.
CREATE FUNCTION app.tell_sending_failed(target uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'SYSTEM' THEN
    PERFORM app.refuse('42501');
  END IF;
  INSERT INTO public.notifications (user_id, kind, actor_id, target_id, case_id, creditor_id, case_count)
  SELECT u.id, 'SENDING_FAILED'::text::public.notification_kind, u.id, u.id, s.case_id, s.creditor_id, 1
  FROM public.sendings s JOIN public.users u ON u.id = s.created_by
  WHERE s.id = target AND s.status = 'FAILED' AND u.status = 'ACTIVE' AND app.case_writable(s.case_id);
END
$$;
GRANT EXECUTE ON FUNCTION app.tell_sending_failed(uuid) TO legarec_worker;
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM legarec_definer;
