-- Litigation in a minimal follow-up (question 163): the stage, the court and the partner, typed by whoever acts on the case.
-- The acts and their deadlines stay with the lawyer or the bailiff; the history of the case keeps each step.

CREATE TYPE litigation_stage AS ENUM ('FORMAL_NOTICE', 'PAYMENT_ORDER', 'ENFORCEABLE_TITLE', 'ENFORCEMENT', 'CLOSED');
CREATE TYPE litigation_consent AS ENUM ('NOT_NEEDED', 'WAITING', 'RECEIVED');

CREATE TABLE litigation_files (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  case_id uuid NOT NULL,
  creditor_id uuid NOT NULL,
  stage litigation_stage NOT NULL DEFAULT 'FORMAL_NOTICE',
  stage_since date NOT NULL DEFAULT (now() AT TIME ZONE 'Europe/Paris')::date,
  court text CHECK (length(court) <= 200),
  partner_name text CHECK (length(partner_name) <= 200),
  -- Written agreement of the creditor, when the mandate asks for one: a box ticked by whoever acts on the case.
  consent litigation_consent NOT NULL,
  consent_noted_by uuid REFERENCES users (id),
  consent_noted_at timestamptz(3),
  -- Day the case reached an enforceable title: the count of the year on the screen.
  title_on date,
  created_by uuid NOT NULL DEFAULT app.user_id() REFERENCES users (id),
  on_behalf_of_id uuid DEFAULT app.on_behalf_of() REFERENCES users (id),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  FOREIGN KEY (case_id, creditor_id) REFERENCES cases (id, creditor_id),
  CONSTRAINT litigation_files_case UNIQUE (case_id),
  CHECK ((consent = 'RECEIVED') = (consent_noted_at IS NOT NULL AND consent_noted_by IS NOT NULL))
);
CREATE INDEX litigation_files_stage ON litigation_files (stage);

-- Read by whoever reads the case; opened and followed by whoever acts on it (policies of the case tables).
CALL app.secure_case_table('litigation_files');
GRANT SELECT (id, case_id, creditor_id, stage, stage_since, court, partner_name, consent, consent_noted_by, consent_noted_at, title_on,
  created_by, on_behalf_of_id, created_at, version),
  INSERT (case_id, creditor_id, stage, consent, version), UPDATE (stage, court, partner_name, consent, version) ON litigation_files TO legarec_staff;

-- As every table attached to a case (20261126180000_case_retention, whose loop ran before this table existed):
-- nothing is added to an anonymized case nor changed in it.
CREATE POLICY case_not_forgotten_add ON litigation_files AS RESTRICTIVE FOR INSERT TO legarec_staff, legarec_partner, legarec_debtor, legarec_worker
  WITH CHECK (case_id IS NULL OR app.case_writable(case_id));
CREATE POLICY case_not_forgotten_change ON litigation_files AS RESTRICTIVE FOR UPDATE TO legarec_staff, legarec_partner, legarec_debtor, legarec_worker
  USING (case_id IS NULL OR app.case_writable(case_id));

-- What the follow-up allows, whatever the caller: one step forward at a time, or closed from any step; nothing after closing;
-- no step that engages costs while the agreement of the creditor is awaited; an agreement noted stays noted; each
-- change adds one to the version. Whether the mandate asks for the agreement is decided by the API, at the opening.
-- The dates and the author of the agreement come from the session, never from the request.
CREATE FUNCTION app.litigation_rules() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  today date := (now() AT TIME ZONE 'Europe/Paris')::date;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.stage <> 'FORMAL_NOTICE' OR NEW.consent_noted_by IS NOT NULL OR NEW.consent_noted_at IS NOT NULL OR NEW.title_on IS NOT NULL THEN
      RAISE EXCEPTION 'litigation opened at its first step' USING ERRCODE = 'LG409';
    END IF;
    NEW.stage_since := today;
    NEW.version := 1;
    IF NEW.consent = 'RECEIVED' THEN
      NEW.consent_noted_by := app.user_id();
      NEW.consent_noted_at := now();
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.stage = 'CLOSED' THEN
    RAISE EXCEPTION 'litigation closed' USING ERRCODE = 'LG409';
  END IF;
  IF NEW.version IS DISTINCT FROM OLD.version + 1 THEN
    RAISE EXCEPTION 'one version at a time' USING ERRCODE = 'LG409';
  END IF;
  IF NEW.consent IS DISTINCT FROM OLD.consent THEN
    IF OLD.consent <> 'WAITING' OR NEW.consent <> 'RECEIVED' THEN
      RAISE EXCEPTION 'agreement already settled' USING ERRCODE = 'LG409';
    END IF;
    NEW.consent_noted_by := app.user_id();
    NEW.consent_noted_at := now();
  ELSE
    NEW.consent_noted_by := OLD.consent_noted_by;
    NEW.consent_noted_at := OLD.consent_noted_at;
  END IF;
  IF NEW.stage IS DISTINCT FROM OLD.stage THEN
    IF NEW.stage <> 'CLOSED' AND array_position(enum_range(NULL::litigation_stage), NEW.stage)
      <> array_position(enum_range(NULL::litigation_stage), OLD.stage) + 1 THEN
      RAISE EXCEPTION 'one step at a time' USING ERRCODE = 'LG409';
    END IF;
    IF NEW.stage <> 'CLOSED' AND NEW.consent = 'WAITING' THEN
      RAISE EXCEPTION 'agreement of the creditor awaited' USING ERRCODE = 'LG409';
    END IF;
    NEW.stage_since := today;
    IF NEW.stage = 'ENFORCEABLE_TITLE' THEN
      NEW.title_on := today;
    END IF;
  ELSE
    NEW.stage_since := OLD.stage_since;
  END IF;
  IF NEW.stage <> 'ENFORCEABLE_TITLE' OR NEW.stage IS NOT DISTINCT FROM OLD.stage THEN
    NEW.title_on := OLD.title_on;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER litigation_rules BEFORE INSERT OR UPDATE ON litigation_files FOR EACH ROW EXECUTE FUNCTION app.litigation_rules();
