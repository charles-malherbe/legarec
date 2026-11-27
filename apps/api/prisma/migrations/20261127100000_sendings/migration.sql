-- What leaves for a debtor (lot Q): reminders by e-mail (Resend), one line each. The line is written with the request, in
-- its transaction; the worker sends, then says what happened. A line never holds an address: the coordinate is read again
-- when the message leaves. The letters (MySendingBox) come with their own migration: their two channels are named here
-- because the caps of app.sent_contacts() already count them.

CREATE TYPE sending_channel AS ENUM ('EMAIL', 'LETTER', 'REGISTERED_LETTER');
CREATE TYPE sending_status AS ENUM ('QUEUED', 'SENT', 'FAILED', 'UNCERTAIN');

CREATE TABLE sendings (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  case_id uuid NOT NULL,
  creditor_id uuid NOT NULL,
  channel sending_channel NOT NULL,
  template text NOT NULL CHECK (template IN ('FRIENDLY', 'FIRM', 'FORMAL_NOTICE', 'PAYMENT_PLAN', 'CLEARANCE', 'INSTALLMENT')),
  -- Level of the validated e-mail reminder (reminder-1 to reminder-3).
  level integer CHECK (level BETWEEN 1 AND 3),
  -- The coordinate an e-mail leaves for: read again by the worker, gone with the case. Never that of another case.
  contact_id uuid,
  document_id uuid,
  status sending_status NOT NULL DEFAULT 'QUEUED',
  -- Without the key of the service outside production: nothing left this machine.
  simulated boolean NOT NULL DEFAULT false,
  provider_ref text CHECK (provider_ref ~ '^[A-Za-z0-9_-]{1,100}$'),
  failure text CHECK (failure ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  created_by uuid NOT NULL DEFAULT app.user_id() REFERENCES users (id),
  on_behalf_of_id uuid DEFAULT app.on_behalf_of() REFERENCES users (id),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  sent_at timestamptz(3),
  FOREIGN KEY (case_id, creditor_id) REFERENCES cases (id, creditor_id),
  FOREIGN KEY (contact_id, case_id) REFERENCES case_contacts (id, case_id),
  FOREIGN KEY (document_id, case_id) REFERENCES documents (id, case_id),
  CHECK ((channel = 'EMAIL') = (contact_id IS NOT NULL)),
  CHECK (level IS NULL OR channel = 'EMAIL')
);
CREATE INDEX sendings_case ON sendings (case_id, created_at);
CREATE INDEX sendings_waiting ON sendings (status) WHERE status = 'QUEUED';

-- Once only, as a rule of the database: a line is born queued, is taken (uncertain) before anything leaves, then is sent or
-- failed; one that never left may fail from the queue. Never back, and a settled line never changes again.
CREATE FUNCTION app.keep_sending() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'QUEUED' OR NEW.simulated OR NEW.sent_at IS NOT NULL OR NEW.provider_ref IS NOT NULL OR NEW.failure IS NOT NULL THEN
      RAISE EXCEPTION 'a sending starts queued' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.case_id, NEW.creditor_id, NEW.channel, NEW.template, NEW.level, NEW.contact_id, NEW.created_by, NEW.on_behalf_of_id, NEW.created_at)
      IS DISTINCT FROM (OLD.id, OLD.case_id, OLD.creditor_id, OLD.channel, OLD.template, OLD.level, OLD.contact_id, OLD.created_by, OLD.on_behalf_of_id, OLD.created_at)
    OR NOT ((OLD.status = 'QUEUED' AND NEW.status IN ('QUEUED', 'UNCERTAIN', 'FAILED'))
      OR (OLD.status = 'UNCERTAIN' AND NEW.status IN ('UNCERTAIN', 'SENT', 'FAILED')))
    OR (NEW.status <> 'SENT' AND (NEW.simulated OR NEW.sent_at IS NOT NULL OR NEW.provider_ref IS NOT NULL))
    OR (NEW.status <> 'FAILED' AND NEW.failure IS NOT NULL) THEN
    RAISE EXCEPTION 'a sending never goes back' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER keep_sending BEFORE INSERT OR UPDATE ON sendings FOR EACH ROW EXECUTE FUNCTION app.keep_sending();

-- Read by whoever reads the case; started by whoever acts on it (policies of the case tables). Only the worker says what left.
CALL app.secure_case_table('sendings');
GRANT SELECT (id, case_id, creditor_id, channel, template, level, contact_id, document_id, status, simulated, failure,
  created_by, on_behalf_of_id, created_at, sent_at),
  INSERT (case_id, creditor_id, channel, template, level, contact_id) ON sendings TO legarec_staff;
GRANT SELECT (id, case_id, creditor_id, channel, template, level, contact_id, document_id, status, simulated,
  provider_ref, failure, created_by, created_at, sent_at),
  UPDATE (document_id, status, simulated, provider_ref, failure, sent_at) ON sendings TO legarec_worker;
DROP POLICY staff_update ON sendings;
DROP POLICY staff_delete ON sendings;

-- As every table attached to a case: nothing is added to an anonymized case nor changed in it.
CREATE POLICY case_not_forgotten_add ON sendings AS RESTRICTIVE FOR INSERT TO legarec_staff, legarec_partner, legarec_debtor, legarec_worker
  WITH CHECK (app.case_writable(case_id));
CREATE POLICY case_not_forgotten_change ON sendings AS RESTRICTIVE FOR UPDATE TO legarec_staff, legarec_partner, legarec_debtor, legarec_worker
  USING (app.case_writable(case_id));

GRANT CREATE ON SCHEMA app TO legarec_definer;
GRANT SELECT (id, case_id, channel, status, created_at, sent_at) ON sendings TO legarec_definer;
CREATE POLICY definer_read ON sendings FOR SELECT TO legarec_definer USING (true);
SET LOCAL ROLE legarec_definer;
-- The caps count every contact of the debtor, whatever the creditor: cases another reads included. Only a number
-- leaves; the caller must act on the case. Whoever counts holds the debtor until the end of the transaction: two
-- colleagues who send at the same moment are counted one after the other, never both under the cap.
-- `wanted`: 'EMAIL', or 'LETTER' for every letter, registered or not. What failed before leaving does not count. A
-- sending counts on the day it left; one that still waits, on the day it was asked.
CREATE FUNCTION app.sent_contacts(target uuid, wanted text, from_day date, to_day date) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  person uuid;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'STAFF' OR wanted NOT IN ('EMAIL', 'LETTER') THEN
    PERFORM app.refuse('42501');
  END IF;
  SELECT c.debtor_id INTO person FROM public.cases c WHERE c.id = target AND app.can_act_on_case(c.officer_id);
  IF person IS NULL THEN
    PERFORM app.refuse('42501');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('contacts:' || person::text, 0));
  RETURN (SELECT count(*)::integer FROM public.sendings s JOIN public.cases c ON c.id = s.case_id
    WHERE c.debtor_id = person AND s.status <> 'FAILED'
      AND ((wanted = 'EMAIL' AND s.channel = 'EMAIL') OR (wanted = 'LETTER' AND s.channel IN ('LETTER', 'REGISTERED_LETTER')))
      AND (coalesce(s.sent_at, s.created_at) AT TIME ZONE 'Europe/Paris')::date BETWEEN from_day AND to_day);
END
$$;
-- The key of a sending service, for the worker alone, when it is valid.
CREATE FUNCTION app.service_key(wanted text, OUT id uuid, OUT value_cipher bytea)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'SYSTEM' OR wanted NOT IN ('RESEND_API_KEY', 'MYSENDINGBOX_API_KEY', 'MYSENDINGBOX_TEST_API_KEY') THEN
    PERFORM app.refuse('42501');
  END IF;
  SELECT s.id, s.value_cipher INTO id, value_cipher FROM public.vault_secrets s
  WHERE s.name::text = wanted AND s.status = 'VALID' AND s.value_cipher IS NOT NULL ORDER BY s.created_at DESC LIMIT 1;
END
$$;
-- Whether a sending service has its key, for the team: yes or no, nothing of the key. Asked before a request is taken
-- in production, where nothing is simulated.
CREATE FUNCTION app.service_ready(wanted text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'STAFF' OR wanted NOT IN ('RESEND_API_KEY', 'MYSENDINGBOX_API_KEY', 'MYSENDINGBOX_TEST_API_KEY') THEN
    PERFORM app.refuse('42501');
  END IF;
  RETURN EXISTS (SELECT 1 FROM public.vault_secrets s WHERE s.name::text = wanted AND s.status = 'VALID' AND s.value_cipher IS NOT NULL);
END
$$;
GRANT EXECUTE ON FUNCTION app.sent_contacts(uuid, text, date, date) TO legarec_staff;
GRANT EXECUTE ON FUNCTION app.service_ready(text) TO legarec_staff;
GRANT EXECUTE ON FUNCTION app.service_key(text) TO legarec_worker;
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM legarec_definer;

-- Retention: a sending goes with what its case holds about the debtor. A new version of app.forget_case(), still owned by
-- legarec_forgetter, with its rights on the table.
CREATE POLICY forgetter_all ON sendings TO legarec_forgetter USING (true) WITH CHECK (true);
GRANT SELECT (case_id), DELETE ON sendings TO legarec_forgetter;
GRANT CREATE ON SCHEMA app TO legarec_forgetter;
SET LOCAL ROLE legarec_forgetter;
-- Everything a case holds about its debtor, but what accounting keeps ten years, and its history without names.
CREATE OR REPLACE FUNCTION app.forget_case(target uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  debtor_name text;
  given_name text;
  contact text;
BEGIN
  DELETE FROM public.case_contact_events WHERE case_id = target;
  -- The history stays without names (question 169): what was typed goes, a title that names the debtor or the person to
  -- reach is replaced, who of the team acted stays (question 132).
  SELECT nullif(btrim(d.name), ''), nullif(btrim(c.deposited_name), ''), nullif(btrim(c.contact_name), '') INTO debtor_name, given_name, contact
  FROM public.cases c JOIN public.debtors d ON d.id = c.debtor_id WHERE c.id = target;
  -- Names compared without accents, signs nor legal forms (« SARL Dupont » finds « Dupont »).
  UPDATE public.case_events e SET detail = NULL,
    title = CASE WHEN EXISTS (SELECT 1 FROM unnest(ARRAY[debtor_name, given_name, contact]) AS n(value)
        WHERE length(app.plain_name(n.value)) >= 3 AND strpos(app.plain_name(e.title), app.plain_name(n.value)) > 0) THEN 'Événement du dossier' ELSE e.title END
  WHERE e.case_id = target;
  -- What left for the debtor (lot Q), before the coordinates it points at: whom it reached goes.
  DELETE FROM public.sendings WHERE case_id = target;
  DELETE FROM public.case_contacts WHERE case_id = target;
  DELETE FROM public.portal_message_attachments WHERE case_id = target;
  DELETE FROM public.portal_messages WHERE case_id = target;
  DELETE FROM public.planned_reminders WHERE case_id = target;
  DELETE FROM public.debtor_links WHERE case_id = target;
  DELETE FROM public.ai_suggestions WHERE case_id = target;
  DELETE FROM public.litigation_files WHERE case_id = target;
  -- The plans and the payments stay; who accepted from where, why the firm decided, why a cheque bounced, go.
  UPDATE public.payment_plans SET accepted_ip = NULL WHERE case_id = target AND accepted_ip IS NOT NULL;
  UPDATE public.plan_approvals SET reason = NULL WHERE case_id = target AND reason IS NOT NULL;
  UPDATE public.payments SET bounce_reason = NULL WHERE case_id = target AND bounce_reason IS NOT NULL;
  -- The attachments, but the pieces of accounting (receipts, signed plans): their files go with the next purge.
  UPDATE public.documents d SET title = 'Pièce supprimée', original_name = 'piece-supprimee', purged_at = now(), visible_to_debtor = false,
    shared_with_creditor_at = NULL, shared_by = NULL
  WHERE d.case_id = target AND d.purged_at IS NULL AND d.retention_class = 'CASE'
    AND NOT EXISTS (SELECT 1 FROM public.receipts r WHERE r.document_id = d.id)
    AND NOT EXISTS (SELECT 1 FROM public.payment_plans p WHERE p.document_id = d.id);
  UPDATE public.cases c SET debtor_siret = NULL, debtor_address = NULL, debtor_postal_code = NULL, debtor_city = NULL, contact_name = NULL,
    contact_title = NULL, external_reference = NULL, deposited_name = NULL, anonymized_at = now()
  WHERE c.id = target;
END
$$;
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM legarec_forgetter;
