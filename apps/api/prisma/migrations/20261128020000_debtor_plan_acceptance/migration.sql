-- « Accepter cet échéancier » in the space of the debtor (question 76): the PDF of the plan is written by the worker as soon
-- as the plan waits for the debtor (`plan-pdf`, file `pdf`); the debtor accepts that very file, whose fingerprint is kept
-- with the date and the address. The debtor also downloads the files shown to it: this PDF and its receipts.

-- What the worker reads and writes of a plan to give it its PDF, once.
GRANT SELECT (document_id), UPDATE (document_id, document_sha256) ON payment_plans TO legarec_worker;
-- What the debtor reads: whether the PDF is there, and which one it accepts; the file of a receipt.
GRANT SELECT (document_id, document_sha256) ON payment_plans TO legarec_debtor;
GRANT SELECT (document_id) ON receipts TO legarec_debtor;
-- What the functions below read and change.
GRANT SELECT (total_cents, document_sha256), UPDATE (accepted_at, accepted_ip) ON payment_plans TO legarec_definer;
GRANT SELECT (kind, visible_to_debtor) ON documents TO legarec_definer;

GRANT CREATE ON SCHEMA app TO legarec_definer;
SET LOCAL ROLE legarec_definer;

-- A plan comes to the debtor (at its request when nobody else must agree, or once the creditor agreed): its PDF is queued,
-- by whoever made it come, with the transaction.
CREATE FUNCTION app.queue_plan_pdf() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.status = 'WAITING_DEBTOR' AND NEW.document_id IS NULL AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    PERFORM app.enqueue('pdf', 'plan-pdf', jsonb_build_object('plan', NEW.id), 'plan:' || NEW.id::text, NULL);
  END IF;
  RETURN NULL;
END
$$;

-- The debtor of the session accepts the plan proposed on one of its cases, as it read it: the fingerprint of the PDF, the
-- total and the number of installments it was shown. Anything else changed since: 409, nothing is accepted.
CREATE FUNCTION app.debtor_accept_plan(target uuid, fingerprint text, total integer, count integer) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  plan record;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'DEBTOR' OR app.debtor_id() IS NULL THEN
    PERFORM app.refuse('42501');
  END IF;
  SELECT p.id, p.case_id, p.creditor_id, p.months, p.total_cents, p.document_sha256 INTO plan
  FROM public.payment_plans p JOIN public.cases c ON c.id = p.case_id
  WHERE p.case_id = target AND p.status = 'WAITING_DEBTOR'
    AND c.debtor_id = app.debtor_id() AND c.first_letter_on IS NOT NULL AND c.closed_on IS NULL AND c.anonymized_at IS NULL
  FOR UPDATE OF p;
  IF NOT FOUND THEN
    PERFORM app.refuse('LG404');
  END IF;
  IF plan.document_sha256 IS NULL OR plan.document_sha256 <> fingerprint OR plan.total_cents <> total OR plan.months <> count THEN
    PERFORM app.refuse('LG409');
  END IF;
  UPDATE public.plan_approvals a SET decision = 'APPROVED', decided_at = now()
  WHERE a.plan_id = plan.id AND a.step = 'DEBTOR' AND a.decision = 'PENDING';
  IF NOT FOUND THEN
    PERFORM app.refuse('LG409');
  END IF;
  UPDATE public.payment_plans p SET status = 'ACTIVE', accepted_at = now(), accepted_ip = app.setting('ip')::inet, version = p.version + 1 WHERE p.id = plan.id;
  PERFORM app.add_case_event(plan.case_id, 'PLAN_DEBTOR_ACCEPTED', 'Échéancier accepté par le débiteur', plan.months || ' mensualités', 'success', true);
  PERFORM app.log('PLAN_DEBTOR_ACCEPTED', 'case', plan.case_id, jsonb_build_object('months', least(plan.months, 999)));
END
$$;

-- The file of a document shown to the debtor of the session, on one of its open cases: its key never leaves the API.
CREATE FUNCTION app.debtor_file(target uuid, OUT storage_key text, OUT kind document_kind)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'DEBTOR' OR app.debtor_id() IS NULL THEN
    PERFORM app.refuse('42501');
  END IF;
  SELECT d.storage_key, d.kind INTO storage_key, kind
  FROM public.documents d JOIN public.cases c ON c.id = d.case_id
  WHERE d.id = target AND d.visible_to_debtor AND d.scan_status = 'CLEAN' AND NOT d.contains_access_code AND d.purged_at IS NULL
    AND c.debtor_id = app.debtor_id() AND c.first_letter_on IS NOT NULL AND c.closed_on IS NULL AND c.anonymized_at IS NULL;
  IF NOT FOUND THEN
    PERFORM app.refuse('LG404');
  END IF;
END
$$;

GRANT EXECUTE ON FUNCTION app.debtor_accept_plan(uuid, text, integer, integer), app.debtor_file(uuid) TO legarec_debtor;
-- The owner of the tables attaches the trigger.
GRANT EXECUTE ON FUNCTION app.queue_plan_pdf() TO legarec_owner;
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM legarec_definer;

CREATE TRIGGER queue_plan_pdf AFTER INSERT OR UPDATE OF status ON payment_plans FOR EACH ROW EXECUTE FUNCTION app.queue_plan_pdf();

-- The receipts already written are shown to their debtor, as the next ones will be.
UPDATE documents SET visible_to_debtor = true
WHERE category = 'RECEIPT' AND source = 'GENERATED' AND scan_status = 'CLEAN' AND NOT contains_access_code AND case_id IS NOT NULL AND purged_at IS NULL;
-- The plans already waiting for their debtor get their PDF too.
INSERT INTO outbox (queue, name, payload, actor_kind)
SELECT 'pdf', 'plan-pdf', jsonb_build_object('plan', p.id), 'SYSTEM' FROM payment_plans p WHERE p.status = 'WAITING_DEBTOR' AND p.document_id IS NULL;
