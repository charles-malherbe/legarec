-- A reminder that has not left (refused, failed, expired) is told to the colleague who asked for it, in the application
-- (lot Q): until now only the history of the case said it. Written by the worker with the failure, in its transaction.
-- Neither an address nor the reason: the case, as the other notifications of a case.

ALTER TYPE notification_kind ADD VALUE 'SENDING_FAILED';
-- The line a notice is about: once per line, as a rule of the database. No foreign key: the line goes with the
-- anonymization of its case, the notice stays (it then says nothing of the case).
ALTER TABLE notifications ADD COLUMN sending_id uuid,
  DROP CONSTRAINT notifications_case,
  ADD CONSTRAINT notifications_case CHECK (case_id IS NULL OR (creditor_id IS NOT NULL AND kind::text IN ('CASE_ASSIGNED', 'PLAN_DECIDED', 'DEBTOR_BLOCKED', 'SENDING_FAILED'))),
  ADD CONSTRAINT notifications_sending CHECK (sending_id IS NULL OR (case_id IS NOT NULL AND kind::text = 'SENDING_FAILED'));
CREATE UNIQUE INDEX notifications_sending_once ON notifications (sending_id) WHERE sending_id IS NOT NULL;
GRANT SELECT (sending_id) ON notifications TO legarec_staff;

GRANT CREATE ON SCHEMA app TO legarec_definer;
GRANT SELECT (creditor_id, created_by) ON sendings TO legarec_definer;
GRANT SELECT (case_id, sending_id, read_at), INSERT (sending_id) ON notifications TO legarec_definer;
CREATE POLICY definer_read_sending_failed ON notifications FOR SELECT TO legarec_definer USING (kind::text = 'SENDING_FAILED');
SET LOCAL ROLE legarec_definer;
-- For the worker alone, about a line that has failed. Nobody is told when the colleague has left the firm, nor about a
-- case that has been anonymized since. Whether they still read the case is decided when the notification is read.
-- A batch that fails wholesale does not bury the other notifications: five cases an hour are named to a colleague, then
-- a single notice says that others have not left, until it is read.
CREATE FUNCTION app.tell_sending_failed(target uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  author uuid;
  about uuid;
  creditor uuid;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'SYSTEM' THEN
    PERFORM app.refuse('42501');
  END IF;
  SELECT u.id, s.case_id, s.creditor_id INTO author, about, creditor
  FROM public.sendings s JOIN public.users u ON u.id = s.created_by
  WHERE s.id = target AND s.status = 'FAILED' AND u.status = 'ACTIVE' AND app.case_writable(s.case_id);
  IF author IS NULL THEN
    RETURN;
  END IF;
  -- One at a time per colleague: the count below is exact.
  PERFORM pg_advisory_xact_lock(hashtextextended('sending-notice:' || author::text, 0));
  IF EXISTS (SELECT 1 FROM public.notifications n WHERE n.sending_id = target) THEN
    RETURN;
  END IF;
  IF (SELECT count(*) FROM public.notifications n WHERE n.user_id = author AND n.kind::text = 'SENDING_FAILED' AND n.sending_id IS NOT NULL
      AND n.created_at > now() - interval '1 hour') < 5 THEN
    INSERT INTO public.notifications (user_id, kind, actor_id, target_id, case_id, creditor_id, case_count, sending_id)
    VALUES (author, 'SENDING_FAILED'::text::public.notification_kind, author, author, about, creditor, 1, target)
    ON CONFLICT DO NOTHING;
  ELSIF NOT EXISTS (SELECT 1 FROM public.notifications n WHERE n.user_id = author AND n.kind::text = 'SENDING_FAILED' AND n.sending_id IS NULL
      AND n.read_at IS NULL AND n.created_at > now() - interval '1 hour') THEN
    INSERT INTO public.notifications (user_id, kind, actor_id, target_id) VALUES (author, 'SENDING_FAILED'::text::public.notification_kind, author, author);
  END IF;
END
$$;
GRANT EXECUTE ON FUNCTION app.tell_sending_failed(uuid) TO legarec_worker;
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM legarec_definer;
