-- The assistant (docs/ia.md): every suggestion is kept with what was sent in short, the model, the version of the prompt,
-- its cost and the decision of a colleague. The AI suggests; nothing it says is applied without a click.

ALTER TABLE outbox DROP CONSTRAINT outbox_queue_check,
  ADD CONSTRAINT outbox_queue_check CHECK (queue IN ('email', 'staff-email', 'sms', 'letter', 'pdf', 'imap', 'reminders', 'maintenance', 'documents', 'ai'));

CREATE TYPE ai_feature AS ENUM ('CASE_SUMMARY');
CREATE TYPE ai_outcome AS ENUM ('SUGGESTED', 'REFUSED_BY_GUARD', 'FAILED', 'OVER_BUDGET');
CREATE TYPE ai_decision AS ENUM ('PENDING', 'ACCEPTED', 'MODIFIED', 'IGNORED', 'REPORTED');

CREATE TABLE ai_suggestions (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  feature ai_feature NOT NULL,
  case_id uuid NOT NULL,
  creditor_id uuid NOT NULL,
  outcome ai_outcome NOT NULL,
  -- What was sent, in short: counts, never the text (minimisation).
  input_summary text NOT NULL CHECK (length(input_summary) <= 300),
  output jsonb CHECK (output IS NULL OR octet_length(output::text) <= 20000),
  model text CHECK (length(model) <= 120),
  prompt_version text NOT NULL CHECK (prompt_version ~ '^[a-z0-9-]{1,40}$'),
  input_tokens integer NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens integer NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  -- In millionths of a euro.
  cost_micro bigint NOT NULL DEFAULT 0 CHECK (cost_micro >= 0),
  events integer NOT NULL DEFAULT 0 CHECK (events >= 0),
  decision ai_decision NOT NULL DEFAULT 'PENDING',
  decided_by uuid REFERENCES users (id),
  decided_at timestamptz(3),
  decided_for uuid REFERENCES users (id),
  asked_by uuid REFERENCES users (id),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  FOREIGN KEY (case_id, creditor_id) REFERENCES cases (id, creditor_id)
);
CREATE INDEX ai_suggestions_case ON ai_suggestions (case_id, created_at DESC);
CREATE INDEX ai_suggestions_month ON ai_suggestions (created_at);

-- Read with the case; the decision is said by whoever acts on it; written by the worker alone.
CALL app.secure_case_table('ai_suggestions');
GRANT SELECT (id, feature, case_id, creditor_id, outcome, output, model, prompt_version, events, decision, created_at), UPDATE (decision)
  ON ai_suggestions TO legarec_staff;
-- Who decided, when, and for whom: from the session, never from the request.
CREATE FUNCTION app.note_ai_decision() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.decision IS DISTINCT FROM OLD.decision THEN
    IF OLD.decision <> 'PENDING' THEN
      RAISE EXCEPTION 'decided' USING ERRCODE = 'LG409';
    END IF;
    NEW.decided_by := app.user_id();
    NEW.decided_at := now();
    NEW.decided_for := app.on_behalf_of();
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER note_ai_decision BEFORE UPDATE ON ai_suggestions FOR EACH ROW EXECUTE FUNCTION app.note_ai_decision();
GRANT SELECT (id, feature, case_id, creditor_id, outcome, cost_micro, events, decision, created_at),
  INSERT (feature, case_id, creditor_id, outcome, input_summary, output, model, prompt_version, input_tokens, output_tokens, cost_micro, events, asked_by, decision)
  ON ai_suggestions TO legarec_worker;
CREATE POLICY retention_purge ON ai_suggestions FOR DELETE TO legarec_retention USING (created_at < now() - interval '1 year');
CREATE POLICY retention_read ON ai_suggestions FOR SELECT TO legarec_retention USING (true);
GRANT SELECT (id, created_at), DELETE ON ai_suggestions TO legarec_retention;

GRANT CREATE ON SCHEMA app TO legarec_definer;
GRANT SELECT (id, name, value_cipher, status, created_at) ON vault_secrets TO legarec_definer;
GRANT SELECT (created_at, cost_micro) ON ai_suggestions TO legarec_definer;
SET LOCAL ROLE legarec_definer;
-- The key of the provider, for the worker alone, when it is valid.
CREATE FUNCTION app.ai_key(OUT id uuid, OUT value_cipher bytea)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'SYSTEM' THEN
    PERFORM app.refuse('42501');
  END IF;
  SELECT s.id, s.value_cipher INTO id, value_cipher FROM public.vault_secrets s
  WHERE s.name = 'AI_API_KEY' AND s.status = 'VALID' AND s.value_cipher IS NOT NULL ORDER BY s.created_at DESC LIMIT 1;
END
$$;
-- What this month has cost, in millionths of a euro, every case included: the budget is the firm's.
CREATE FUNCTION app.ai_spent() RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT coalesce(sum(s.cost_micro), 0)::bigint FROM public.ai_suggestions s
  WHERE app.actor_kind() = 'SYSTEM' AND s.created_at >= date_trunc('month', now() AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris'
$$;
GRANT EXECUTE ON FUNCTION app.ai_key(), app.ai_spent() TO legarec_worker;
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM legarec_definer;
CREATE POLICY definer_read ON ai_suggestions FOR SELECT TO legarec_definer USING (true);
