-- The registry of the requests of the debtors about their data (RGPD): written by whoever acts on the case, kept by the
-- Director and their administrative delegate, answered within a month, kept 10 years (question 115).

CREATE TYPE gdpr_kind AS ENUM ('ACCESS', 'RECTIFICATION', 'OBJECTION', 'ERASURE');
CREATE TYPE gdpr_status AS ENUM ('OPEN', 'ANSWERED', 'REFUSED');

CREATE TABLE gdpr_requests (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  case_id uuid NOT NULL,
  creditor_id uuid NOT NULL,
  debtor_id uuid NOT NULL REFERENCES debtors (id),
  kind gdpr_kind NOT NULL,
  origin text NOT NULL CHECK (length(btrim(origin)) BETWEEN 1 AND 200),
  received_on date NOT NULL DEFAULT (now() AT TIME ZONE 'Europe/Paris')::date,
  due_on date NOT NULL,
  status gdpr_status NOT NULL DEFAULT 'OPEN',
  reason text CHECK (length(reason) <= 1000),
  answered_at timestamptz(3),
  answered_by uuid REFERENCES users (id),
  created_by uuid NOT NULL REFERENCES users (id),
  on_behalf_of_id uuid REFERENCES users (id),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  FOREIGN KEY (case_id, creditor_id) REFERENCES cases (id, creditor_id),
  CHECK (status <> 'REFUSED' OR length(btrim(reason)) > 0)
);
CREATE INDEX gdpr_requests_received ON gdpr_requests (received_on DESC);

GRANT CREATE ON SCHEMA app TO legarec_definer;
GRANT SELECT, INSERT, UPDATE (status, reason, answered_at, answered_by) ON gdpr_requests TO legarec_definer;
GRANT SELECT (id, kind, name, siren, anonymized_at) ON debtors TO legarec_definer;
GRANT SELECT (id, debtor_id, creditor_id, reference, opened_on, closed_on, debtor_address, debtor_postal_code, debtor_city, contact_name) ON cases TO legarec_definer;
GRANT SELECT (id, name) ON creditors TO legarec_definer;
GRANT SELECT (id, case_id, number, issued_on, due_on, principal_cents, principal_paid_cents) ON case_invoices TO legarec_definer;
GRANT SELECT (case_id, kind, label, value, status, created_at) ON case_contacts TO legarec_definer;
GRANT SELECT (case_id, method, amount_cents, status, received_on) ON payments TO legarec_definer;
GRANT SELECT (case_id, title, occurred_at) ON case_events TO legarec_definer;
SET LOCAL ROLE legarec_definer;

-- By whoever acts on the case: a month to answer (article 12 of the RGPD).
CREATE FUNCTION app.gdpr_request(target uuid, wanted gdpr_kind, wanted_origin text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  held record;
  made uuid;
  today date := (now() AT TIME ZONE 'Europe/Paris')::date;
BEGIN
  SELECT * INTO held FROM app.money_case(target);
  INSERT INTO public.gdpr_requests (case_id, creditor_id, debtor_id, kind, origin, received_on, due_on, created_by, on_behalf_of_id)
  VALUES (target, held.creditor_id, held.debtor_id, wanted, btrim(wanted_origin), today, (today + interval '1 month')::date, app.user_id(), app.on_behalf_of())
  RETURNING id INTO made;
  PERFORM app.add_case_event(target, 'GDPR_REQUEST', 'Demande RGPD enregistrée', NULL, 'info', false);
  PERFORM app.log('GDPR_REQUEST_ADDED', 'gdpr_request', made, '{}'::jsonb);
  RETURN made;
END
$$;

-- The Director, or the manager acting for them by the administrative delegation.
CREATE FUNCTION app.gdpr_keeper() RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'STAFF' OR NOT app.acts_as_director('ADMINISTRATIVE') THEN
    PERFORM app.refuse('42501');
  END IF;
END
$$;

CREATE FUNCTION app.gdpr_registry() RETURNS TABLE (id uuid, case_id uuid, kind gdpr_kind, debtor text, origin text, received_on date, due_on date, status gdpr_status)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM app.gdpr_keeper();
  RETURN QUERY SELECT g.id, g.case_id, g.kind, d.name, g.origin, g.received_on, g.due_on, g.status
  FROM public.gdpr_requests g JOIN public.debtors d ON d.id = g.debtor_id ORDER BY g.received_on DESC, g.id DESC LIMIT 500;
END
$$;

CREATE FUNCTION app.gdpr_answer(target uuid, wanted gdpr_status, wanted_reason text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM app.gdpr_keeper();
  IF wanted = 'REFUSED' AND length(btrim(coalesce(wanted_reason, ''))) = 0 THEN
    PERFORM app.refuse('22023');
  END IF;
  UPDATE public.gdpr_requests g SET status = wanted, reason = nullif(btrim(coalesce(wanted_reason, '')), ''),
    answered_at = CASE WHEN wanted = 'OPEN' THEN NULL ELSE now() END, answered_by = CASE WHEN wanted = 'OPEN' THEN NULL ELSE app.user_id() END
  WHERE g.id = target;
  IF NOT FOUND THEN
    PERFORM app.refuse('LG404');
  END IF;
  PERFORM app.log('GDPR_REQUEST_' || wanted::text, 'gdpr_request', target, '{}'::jsonb);
END
$$;

-- What the firm holds on the debtor of a request, across all their cases; never their access code.
CREATE FUNCTION app.gdpr_export(target uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  person uuid;
  data jsonb;
BEGIN
  PERFORM app.gdpr_keeper();
  SELECT g.debtor_id INTO person FROM public.gdpr_requests g WHERE g.id = target;
  IF person IS NULL THEN
    PERFORM app.refuse('LG404');
  END IF;
  SELECT jsonb_build_object(
    'debtor', (SELECT jsonb_build_object('name', d.name, 'kind', d.kind, 'siren', d.siren) FROM public.debtors d WHERE d.id = person),
    'cases', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'reference', c.reference, 'creditor', k.name, 'openedOn', c.opened_on, 'closedOn', c.closed_on,
      'address', concat_ws(' ', c.debtor_address, c.debtor_postal_code, c.debtor_city), 'contact', c.contact_name,
      'invoices', coalesce((SELECT jsonb_agg(jsonb_build_object('number', i.number, 'issuedOn', i.issued_on, 'dueOn', i.due_on, 'principalCents', i.principal_cents, 'paidCents', i.principal_paid_cents) ORDER BY i.due_on) FROM public.case_invoices i WHERE i.case_id = c.id), '[]'),
      'contacts', coalesce((SELECT jsonb_agg(jsonb_build_object('kind', t.kind, 'label', t.label, 'value', t.value, 'status', t.status) ORDER BY t.created_at) FROM public.case_contacts t WHERE t.case_id = c.id), '[]'),
      'payments', coalesce((SELECT jsonb_agg(jsonb_build_object('method', p.method, 'amountCents', p.amount_cents, 'status', p.status, 'receivedOn', p.received_on) ORDER BY p.received_on) FROM public.payments p WHERE p.case_id = c.id), '[]'),
      'history', coalesce((SELECT jsonb_agg(jsonb_build_object('title', e.title, 'at', e.occurred_at) ORDER BY e.occurred_at) FROM public.case_events e WHERE e.case_id = c.id), '[]'),
      'messages', coalesce((SELECT jsonb_agg(jsonb_build_object('from', m.side, 'text', m.text, 'at', m.created_at) ORDER BY m.created_at) FROM public.portal_messages m WHERE m.case_id = c.id), '[]')
    ) ORDER BY c.opened_on) FROM public.cases c JOIN public.creditors k ON k.id = c.creditor_id WHERE c.debtor_id = person), '[]')
  ) INTO data;
  PERFORM app.log('GDPR_EXPORTED', 'gdpr_request', target, '{}'::jsonb);
  RETURN data;
END
$$;
GRANT EXECUTE ON FUNCTION app.gdpr_request(uuid, gdpr_kind, text), app.gdpr_keeper(), app.gdpr_registry(), app.gdpr_answer(uuid, gdpr_status, text), app.gdpr_export(uuid) TO legarec_staff;
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM legarec_definer;

CALL app.secure_case_table('gdpr_requests');
CREATE POLICY definer_all ON gdpr_requests TO legarec_definer USING (true) WITH CHECK (true);
CREATE POLICY retention_purge ON gdpr_requests FOR DELETE TO legarec_retention USING (received_on < (now() - interval '10 years')::date);
CREATE POLICY retention_read ON gdpr_requests FOR SELECT TO legarec_retention USING (true);
GRANT SELECT (id, received_on), DELETE ON gdpr_requests TO legarec_retention;
