-- A registered letter that MySendingBox never answered clearly is decided by a person too, as an e-mail. « Partie »: sent on
-- the day it was asked, for the cap; but never the first letter of the case: the number `LR-AAAA-NNNN` and the access of the
-- debtor it opens rest on what MySendingBox answers, not on a person's word (a letter of the test mode looks the same).

GRANT CREATE ON SCHEMA app TO legarec_definer;
GRANT SELECT (template) ON sendings TO legarec_definer;
SET LOCAL ROLE legarec_definer;

CREATE OR REPLACE FUNCTION app.settle_sending(target uuid, outcome text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  about uuid;
  officer uuid;
  step integer;
  way text;
  kind text;
  detail text;
BEGIN
  IF app.staff_role() IS DISTINCT FROM 'COLLECTION_MANAGER' AND app.staff_role() IS DISTINCT FROM 'DIRECTOR' THEN
    PERFORM app.refuse('42501');
  END IF;
  IF outcome IS NULL OR outcome NOT IN ('SENT', 'NOT_SENT') THEN
    PERFORM app.refuse('22023');
  END IF;
  SELECT s.case_id, c.officer_id, s.level, s.channel::text, s.template INTO about, officer, step, way, kind
  FROM public.sendings s JOIN public.cases c ON c.id = s.case_id
  WHERE s.id = target AND s.channel IN ('EMAIL', 'REGISTERED_LETTER');
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
  detail := CASE
    WHEN way = 'REGISTERED_LETTER' THEN 'Courrier recommandé · ' || CASE kind WHEN 'FRIENDLY' THEN 'relance amiable' WHEN 'FIRM' THEN 'relance ferme' WHEN 'FORMAL_NOTICE' THEN 'mise en demeure' ELSE 'courrier' END
    WHEN step IS NULL THEN 'E-mail · rappel d’échéance'
    ELSE 'E-mail · niveau ' || step
  END;
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

RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM legarec_definer;
