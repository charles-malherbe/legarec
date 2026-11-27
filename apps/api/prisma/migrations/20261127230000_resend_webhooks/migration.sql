-- What Resend says of a reminder after it has left (lot Q): accepted, delivered, bounced, complained about. The API checks
-- the signature and writes the event, with identifiers and dates only; the worker ties it to its line of `sendings`.
-- Neither an address nor a subject is ever kept: the body of the event stays in the request.

-- ---------------------------------------------------------------- The events
ALTER TABLE webhook_events
  -- What the event says, from a closed list; `OTHER` for whatever the firm does not follow (opens, clicks, domains…).
  ADD COLUMN kind text CHECK (kind IN ('SENT', 'DELIVERED', 'DELAYED', 'BOUNCED', 'BOUNCED_SOFT', 'COMPLAINED', 'FAILED', 'SUPPRESSED', 'OTHER')),
  ADD COLUMN occurred_at timestamptz(3),
  -- The message at the provider, and the line it was sent for (a tag of the message). No foreign key: the line goes with
  -- the anonymization of its case, and an event may name a line of another environment.
  ADD COLUMN provider_ref uuid,
  ADD COLUMN sending_id uuid;
-- A provider only says that an event has arrived, or that nothing is to be done with it: never that it was handled.
CREATE POLICY hook_status ON webhook_events AS RESTRICTIVE FOR INSERT TO legarec_hook WITH CHECK (status IN ('RECEIVED', 'IGNORED') AND processed_at IS NULL);
GRANT INSERT (status, kind, occurred_at, provider_ref, sending_id) ON webhook_events TO legarec_hook;
GRANT SELECT (kind, occurred_at, provider_ref, sending_id) ON webhook_events TO legarec_worker;

-- ---------------------------------------------------------------- What the provider said of a line
ALTER TABLE sendings
  -- The provider itself said that the message had left its hands (accepted, delivered, delayed, bounced, complained about).
  ADD COLUMN confirmed_at timestamptz(3),
  ADD COLUMN delivered_at timestamptz(3),
  -- It did not reach the address, and why, from a closed list.
  ADD COLUMN undelivered_at timestamptz(3),
  ADD COLUMN undelivered_reason text CHECK (undelivered_reason IN ('HARD_BOUNCE', 'BOUNCE', 'SUPPRESSED', 'PROVIDER_FAILED')),
  ADD COLUMN complained_at timestamptz(3),
  ADD CONSTRAINT sendings_undelivered CHECK ((undelivered_at IS NULL) = (undelivered_reason IS NULL)),
  -- Delivered or complained about: it had left.
  ADD CONSTRAINT sendings_confirmed CHECK ((delivered_at IS NULL AND complained_at IS NULL) OR confirmed_at IS NOT NULL);
-- An event names its message: found without reading the whole table.
CREATE INDEX sendings_provider_ref ON sendings (provider_ref) WHERE provider_ref IS NOT NULL;

-- As before: a line is born queued, is taken (uncertain) before anything leaves, then is sent or failed; never back. A
-- settled line keeps its status, its reference, its failure and its date for ever: a line that has failed never becomes
-- sent, whatever the provider says later. What the provider says of it is added beside, once each, and never to a line
-- that has not been taken nor to a simulated one.
CREATE OR REPLACE FUNCTION app.keep_sending() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'QUEUED' OR NEW.simulated OR NEW.sent_at IS NOT NULL OR NEW.provider_ref IS NOT NULL OR NEW.failure IS NOT NULL
      OR NEW.confirmed_at IS NOT NULL OR NEW.delivered_at IS NOT NULL OR NEW.undelivered_at IS NOT NULL OR NEW.complained_at IS NOT NULL THEN
      RAISE EXCEPTION 'a sending starts queued' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.case_id, NEW.creditor_id, NEW.channel, NEW.template, NEW.level, NEW.contact_id, NEW.created_by, NEW.on_behalf_of_id, NEW.created_at)
      IS DISTINCT FROM (OLD.id, OLD.case_id, OLD.creditor_id, OLD.channel, OLD.template, OLD.level, OLD.contact_id, OLD.created_by, OLD.on_behalf_of_id, OLD.created_at)
    OR (OLD.status IN ('SENT', 'FAILED') AND (NEW.status, NEW.simulated, NEW.provider_ref, NEW.failure, NEW.sent_at, NEW.document_id)
      IS DISTINCT FROM (OLD.status, OLD.simulated, OLD.provider_ref, OLD.failure, OLD.sent_at, OLD.document_id))
    OR NOT ((OLD.status = 'QUEUED' AND NEW.status IN ('QUEUED', 'UNCERTAIN', 'FAILED'))
      OR (OLD.status = 'UNCERTAIN' AND NEW.status IN ('UNCERTAIN', 'SENT', 'FAILED'))
      OR (OLD.status IN ('SENT', 'FAILED') AND NEW.status = OLD.status))
    OR (NEW.status <> 'SENT' AND (NEW.simulated OR NEW.sent_at IS NOT NULL OR NEW.provider_ref IS NOT NULL))
    OR (NEW.status <> 'FAILED' AND NEW.failure IS NOT NULL) THEN
    RAISE EXCEPTION 'a sending never goes back' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (OLD.confirmed_at IS NOT NULL AND NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at)
    OR (OLD.delivered_at IS NOT NULL AND NEW.delivered_at IS DISTINCT FROM OLD.delivered_at)
    OR (OLD.undelivered_at IS NOT NULL AND (NEW.undelivered_at, NEW.undelivered_reason) IS DISTINCT FROM (OLD.undelivered_at, OLD.undelivered_reason))
    OR (OLD.complained_at IS NOT NULL AND NEW.complained_at IS DISTINCT FROM OLD.complained_at)
    OR ((NEW.status IN ('QUEUED', 'UNCERTAIN') OR NEW.simulated)
      AND (NEW.confirmed_at IS NOT NULL OR NEW.delivered_at IS NOT NULL OR NEW.undelivered_at IS NOT NULL OR NEW.complained_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'what the provider said of a sending is written once' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;

GRANT SELECT (confirmed_at, delivered_at, undelivered_at, undelivered_reason, complained_at) ON sendings TO legarec_staff;
GRANT SELECT (confirmed_at, delivered_at, undelivered_at, undelivered_reason, complained_at),
  UPDATE (confirmed_at, delivered_at, undelivered_at, undelivered_reason, complained_at) ON sendings TO legarec_worker;

-- ---------------------------------------------------------------- Functions that see more than their caller
GRANT CREATE ON SCHEMA app TO legarec_definer;
GRANT SELECT (contact_id, simulated, confirmed_at, delivered_at, undelivered_at, undelivered_reason, complained_at) ON sendings TO legarec_definer;
GRANT UPDATE (status, is_primary, invalidated_at) ON case_contacts TO legarec_definer;
-- The definer only ever marks a coordinate as wrong.
CREATE POLICY definer_invalidate ON case_contacts FOR UPDATE TO legarec_definer USING (true) WITH CHECK (status = 'INVALID');
GRANT SELECT (contact_id, occurred_at) ON case_contact_events TO legarec_definer;
CREATE POLICY definer_read ON case_contact_events FOR SELECT TO legarec_definer USING (true);
SET LOCAL ROLE legarec_definer;

-- The secret that signs the events of Resend, for the route that receives them alone, when it is valid.
CREATE FUNCTION app.hook_secret(wanted text, OUT id uuid, OUT value_cipher bytea)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'HOOK' OR wanted IS DISTINCT FROM 'RESEND_WEBHOOK_SECRET' THEN
    PERFORM app.refuse('42501');
  END IF;
  SELECT s.id, s.value_cipher INTO id, value_cipher FROM public.vault_secrets s
  WHERE s.name::text = wanted AND s.status = 'VALID' AND s.value_cipher IS NOT NULL ORDER BY s.created_at DESC LIMIT 1;
END
$$;

-- As before, and a line that has failed counts when the provider itself said that the message had left: the cap then
-- holds, whatever the line says. On the day the provider said it.
CREATE OR REPLACE FUNCTION app.sent_contacts(target uuid, wanted text, from_day date, to_day date) RETURNS integer
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
    WHERE c.debtor_id = person AND (s.status <> 'FAILED' OR s.confirmed_at IS NOT NULL)
      AND ((wanted = 'EMAIL' AND s.channel = 'EMAIL') OR (wanted = 'LETTER' AND s.channel IN ('LETTER', 'REGISTERED_LETTER')))
      AND (coalesce(s.sent_at, s.confirmed_at, s.created_at) AT TIME ZONE 'Europe/Paris')::date BETWEEN from_day AND to_day);
END
$$;

-- An address the provider can no longer write to (hard bounce, address it has suppressed, complaint) is marked as wrong,
-- as a colleague would: no reminder leaves for it until someone puts it right (question 224). For the worker alone, and
-- only when the line itself says so; never when a colleague has touched the coordinate since, nor when a later message
-- reached it. True when the coordinate has been marked.
CREATE FUNCTION app.invalidate_unreachable_contact(target uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  about uuid;
  creditor uuid;
  contact uuid;
  since timestamptz;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'SYSTEM' THEN
    PERFORM app.refuse('42501');
  END IF;
  SELECT s.case_id, s.creditor_id, s.contact_id,
    least(s.complained_at, CASE WHEN s.undelivered_reason IN ('HARD_BOUNCE', 'SUPPRESSED') THEN s.undelivered_at END)
  INTO about, creditor, contact, since
  FROM public.sendings s
  WHERE s.id = target AND s.channel = 'EMAIL' AND NOT s.simulated AND s.contact_id IS NOT NULL
    AND (s.complained_at IS NOT NULL OR s.undelivered_reason IN ('HARD_BOUNCE', 'SUPPRESSED')) AND app.case_writable(s.case_id);
  IF contact IS NULL THEN
    RETURN false;
  END IF;
  UPDATE public.case_contacts k SET status = 'INVALID', is_primary = false, invalidated_at = now()
  WHERE k.id = contact AND k.case_id = about AND k.kind = 'EMAIL' AND k.status <> 'INVALID'
    AND NOT EXISTS (SELECT 1 FROM public.case_contact_events e WHERE e.contact_id = k.id AND e.occurred_at > since)
    AND NOT EXISTS (SELECT 1 FROM public.sendings o WHERE o.contact_id = k.id AND o.delivered_at > since);
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  INSERT INTO public.case_contact_events (case_id, creditor_id, contact_id, actor_id, actor_label, what)
  VALUES (about, creditor, contact, NULL, app.actor_label(), 'INVALIDATED');
  RETURN true;
END
$$;

GRANT EXECUTE ON FUNCTION app.hook_secret(text) TO legarec_hook;
GRANT EXECUTE ON FUNCTION app.invalidate_unreachable_contact(uuid) TO legarec_worker;
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM legarec_definer;
