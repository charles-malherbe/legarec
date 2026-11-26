-- The journal of the assistant in Paramètres › Assistant IA (docs/ia.md): read by the Director and the Developer only. Each
-- line says the feature, the case, what was sent in short (counts, never the text), the model and the version of the
-- prompt, the outcome, the decision, the colleague and the cost; never the suggestion itself. The Developer reads no case:
-- the reference is given to whoever may read the case, and to nobody else.

GRANT CREATE ON SCHEMA app TO legarec_definer;
GRANT SELECT (id, feature, case_id, outcome, input_summary, model, prompt_version, input_tokens, output_tokens, decision, decided_by, asked_by)
  ON ai_suggestions TO legarec_definer;
SET LOCAL ROLE legarec_definer;
CREATE FUNCTION app.ai_journal(page_size integer, skip integer)
RETURNS TABLE (
  id uuid, created_at timestamptz, feature text, outcome text, decision text, model text, prompt_version text, input_summary text,
  input_tokens integer, output_tokens integer, cost_micro bigint, colleague text, case_reference text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'STAFF' OR app.staff_role() NOT IN ('DIRECTOR', 'DEVELOPER') THEN
    PERFORM app.refuse('42501');
  END IF;
  RETURN QUERY
  SELECT s.id, s.created_at, s.feature::text, s.outcome::text, s.decision::text, s.model, s.prompt_version, s.input_summary,
    s.input_tokens, s.output_tokens, s.cost_micro,
    (SELECT u.first_name || ' ' || u.last_name FROM public.users u WHERE u.id = coalesce(s.decided_by, s.asked_by)),
    CASE WHEN app.can_read_case(c.officer_id) THEN c.reference END
  FROM public.ai_suggestions s JOIN public.cases c ON c.id = s.case_id
  ORDER BY s.created_at DESC, s.id DESC
  LIMIT least(greatest(page_size, 1), 100) OFFSET greatest(skip, 0);
END
$$;
-- How many lines, and how the suggestions of the last 30 days were decided.
CREATE FUNCTION app.ai_journal_totals(OUT total bigint, OUT suggested bigint, OUT accepted bigint, OUT modified bigint, OUT ignored bigint, OUT reported bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'STAFF' OR app.staff_role() NOT IN ('DIRECTOR', 'DEVELOPER') THEN
    PERFORM app.refuse('42501');
  END IF;
  SELECT count(*),
    count(*) FILTER (WHERE s.created_at > now() - interval '30 days' AND s.outcome = 'SUGGESTED'),
    count(*) FILTER (WHERE s.created_at > now() - interval '30 days' AND s.decision = 'ACCEPTED'),
    count(*) FILTER (WHERE s.created_at > now() - interval '30 days' AND s.decision = 'MODIFIED'),
    count(*) FILTER (WHERE s.created_at > now() - interval '30 days' AND s.decision = 'IGNORED'),
    count(*) FILTER (WHERE s.created_at > now() - interval '30 days' AND s.decision = 'REPORTED')
  INTO total, suggested, accepted, modified, ignored, reported
  FROM public.ai_suggestions s;
END
$$;
GRANT EXECUTE ON FUNCTION app.ai_journal(integer, integer), app.ai_journal_totals() TO legarec_staff;
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM legarec_definer;
