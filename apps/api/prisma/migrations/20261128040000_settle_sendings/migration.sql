-- An « uncertain » sending that Resend never settled (no webhook, message never accepted) is decided by a person: the
-- Collection manager, or the Director on the cases they act on, once 48 hours have passed since it was asked (before
-- that, Resend may still say). « Partie »: sent, on the day it was asked (the prudent reading, as for the cap and the
-- levels). « Non partie »: failed, with a code of the provider (`keep_sending`: a line that was taken only fails so), and
-- a later event of Resend that proves it left is still believed (question 223).

GRANT CREATE ON SCHEMA app TO legarec_definer;
GRANT SELECT (level, created_by), UPDATE (status, sent_at, failure) ON sendings TO legarec_definer;
CREATE POLICY definer_settle ON sendings FOR UPDATE TO legarec_definer USING (status = 'UNCERTAIN') WITH CHECK (status IN ('SENT', 'FAILED'));
SET LOCAL ROLE legarec_definer;

CREATE FUNCTION app.settle_sending(target uuid, outcome text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  about uuid;
  officer uuid;
  step integer;
  detail text;
BEGIN
  IF app.staff_role() IS DISTINCT FROM 'COLLECTION_MANAGER' AND app.staff_role() IS DISTINCT FROM 'DIRECTOR' THEN
    PERFORM app.refuse('42501');
  END IF;
  IF outcome IS NULL OR outcome NOT IN ('SENT', 'NOT_SENT') THEN
    PERFORM app.refuse('22023');
  END IF;
  SELECT s.case_id, c.officer_id, s.level INTO about, officer, step
  FROM public.sendings s JOIN public.cases c ON c.id = s.case_id
  WHERE s.id = target AND s.channel = 'EMAIL';
  IF about IS NULL THEN
    PERFORM app.refuse('LG404');
  END IF;
  IF NOT app.can_act_on_case(officer) THEN
    PERFORM app.refuse('42501');
  END IF;
  UPDATE public.sendings
  SET status = CASE outcome WHEN 'SENT' THEN 'SENT'::sending_status ELSE 'FAILED'::sending_status END,
    sent_at = CASE outcome WHEN 'SENT' THEN created_at END,
    failure = CASE outcome WHEN 'NOT_SENT' THEN 'PROVIDER_UNCONFIRMED' END
  WHERE id = target AND status = 'UNCERTAIN' AND created_at <= now() - interval '48 hours';
  IF NOT FOUND THEN
    PERFORM app.refuse('LG409');
  END IF;
  detail := CASE WHEN step IS NULL THEN 'E-mail · rappel d’échéance' ELSE 'E-mail · niveau ' || step END;
  IF app.case_writable(about) THEN
    IF outcome = 'SENT' THEN
      PERFORM app.add_case_event(about, 'REMINDER_SENT', 'Relance notée partie', detail, 'info'::event_tone, false);
    ELSE
      PERFORM app.add_case_event(about, 'REMINDER_FAILED', 'Relance notée non partie', detail, 'danger'::event_tone, false);
    END IF;
  END IF;
  PERFORM app.log(CASE outcome WHEN 'SENT' THEN 'SENDING_NOTED_SENT' ELSE 'SENDING_NOTED_NOT_SENT' END, 'sending', target, '{}'::jsonb);
END
$$;

GRANT EXECUTE ON FUNCTION app.settle_sending(uuid, text) TO legarec_staff;
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM legarec_definer;
