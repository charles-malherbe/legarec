-- Reminders planned by hand in the agenda (Relances): a date, a channel, an object. The sending itself comes with lot Q;
-- until then, the agenda says what is due and warns of the caps and hours (Paramètres › Relances).

CREATE TYPE planned_kind AS ENUM ('EMAIL', 'SMS', 'CALL', 'LETTER');

CREATE TABLE planned_reminders (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  case_id uuid NOT NULL,
  creditor_id uuid NOT NULL,
  kind planned_kind NOT NULL,
  due_on date NOT NULL,
  due_time text CHECK (due_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  -- What the agenda said when it was planned: over a cap, or outside the hours.
  warning text CHECK (length(warning) <= 200),
  done_at timestamptz(3),
  created_by uuid NOT NULL DEFAULT app.user_id() REFERENCES users (id),
  on_behalf_of_id uuid DEFAULT app.on_behalf_of() REFERENCES users (id),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  FOREIGN KEY (case_id, creditor_id) REFERENCES cases (id, creditor_id)
);
CREATE INDEX planned_reminders_due ON planned_reminders (due_on);
CREATE INDEX planned_reminders_case ON planned_reminders (case_id);

-- Read by whoever reads the case; planned, moved, done and removed by whoever acts on it (policies of the case tables).
CALL app.secure_case_table('planned_reminders');
GRANT SELECT (id, case_id, creditor_id, kind, due_on, due_time, title, warning, done_at, created_by, created_at),
  INSERT (case_id, creditor_id, kind, due_on, due_time, title, warning), UPDATE (due_on, due_time, done_at), DELETE ON planned_reminders TO legarec_staff;
GRANT SELECT (id, case_id, creditor_id, kind, due_on, due_time, title, done_at) ON planned_reminders TO legarec_worker;

GRANT CREATE ON SCHEMA app TO legarec_definer;
GRANT SELECT (id, case_id, kind, due_on, done_at) ON planned_reminders TO legarec_definer;
SET LOCAL ROLE legarec_definer;
-- The caps count every contact of the debtor, whatever the creditor (`.claude/rules/api.md`): cases another reads included.
-- Only a number leaves; the caller must act on the case.
CREATE FUNCTION app.planned_contacts(target uuid, wanted planned_kind, from_day date, to_day date) RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  person uuid;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'STAFF' THEN
    PERFORM app.refuse('42501');
  END IF;
  SELECT c.debtor_id INTO person FROM public.cases c WHERE c.id = target AND app.can_act_on_case(c.officer_id);
  IF person IS NULL THEN
    PERFORM app.refuse('42501');
  END IF;
  RETURN (SELECT count(*)::integer FROM public.planned_reminders r JOIN public.cases c ON c.id = r.case_id
    WHERE c.debtor_id = person AND r.kind = wanted AND r.due_on BETWEEN from_day AND to_day);
END
$$;
GRANT EXECUTE ON FUNCTION app.planned_contacts(uuid, planned_kind, date, date) TO legarec_staff;
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM legarec_definer;
CREATE POLICY definer_read ON planned_reminders FOR SELECT TO legarec_definer USING (true);
