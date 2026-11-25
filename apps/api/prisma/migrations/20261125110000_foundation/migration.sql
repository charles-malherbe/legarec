-- Foundation: context of the transaction, single roles, row-level security, append-only journals.
-- Row-level security is enabled and forced on every table; a role sees nothing until a policy says otherwise.

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Nobody connects by default, nor creates temporary objects; the two programs are named.
DO $$
BEGIN
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO legarec_app, legarec_jobs', current_database());
  -- PostgreSQL only warns when someone who does not own the database takes a right back: checked here.
  IF EXISTS (
    SELECT 1 FROM pg_database d, aclexplode(coalesce(d.datacl, acldefault('d', d.datdba))) AS granted
    WHERE d.datname = current_database() AND granted.grantee = 0
  ) THEN
    RAISE EXCEPTION 'database % must belong to legarec_owner (see bootstrap.sql)', current_database();
  END IF;
END
$$;

CREATE SCHEMA app;
REVOKE ALL ON SCHEMA public, app FROM PUBLIC;
GRANT USAGE ON SCHEMA public, app TO
  legarec_auth, legarec_staff, legarec_partner, legarec_debtor, legarec_hook, legarec_public, legarec_service, legarec_worker, legarec_retention, legarec_definer;
GRANT CREATE ON SCHEMA app TO legarec_definer;
-- A new function is never callable by everyone: each one is granted by name.
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- ---------------------------------------------------------------- Helpers

CREATE FUNCTION app.uuid_v7() RETURNS uuid LANGUAGE sql VOLATILE PARALLEL SAFE AS $$
  SELECT encode(
    set_bit(set_bit(
      overlay(uuid_send(gen_random_uuid()) PLACING substring(int8send((extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3) FROM 1 FOR 6),
      52, 1), 53, 1), 'hex')::uuid
$$;

-- Context set by Database.run() with set_config(…, true): it dies with the transaction.
CREATE FUNCTION app.setting(name text) RETURNS text LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT nullif(current_setting('app.' || name, true), '')
$$;
CREATE FUNCTION app.user_id() RETURNS uuid LANGUAGE sql STABLE PARALLEL SAFE AS $$ SELECT app.setting('user_id')::uuid $$;
CREATE FUNCTION app.creditor_id() RETURNS uuid LANGUAGE sql STABLE PARALLEL SAFE AS $$ SELECT app.setting('creditor_id')::uuid $$;
CREATE FUNCTION app.debtor_id() RETURNS uuid LANGUAGE sql STABLE PARALLEL SAFE AS $$ SELECT app.setting('debtor_id')::uuid $$;
-- Owner of an idempotency key: an actor never sees the keys of another one.
CREATE FUNCTION app.actor_key() RETURNS text LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN app.user_id() IS NOT NULL THEN 'user:' || app.user_id()
    WHEN app.debtor_id() IS NOT NULL THEN 'debtor:' || app.debtor_id()
    WHEN app.setting('service') IS NOT NULL THEN 'service:' || app.setting('service')
  END
$$;

-- Codes a task may carry. Closed list, extended by the migrations: a name in capitals is not a code.
CREATE TYPE task_code AS ENUM ('FRIENDLY', 'FIRM', 'FORMAL_NOTICE', 'PAYMENT_PLAN', 'CLEARANCE', 'EMAIL', 'SMS', 'LETTER', 'REGISTERED_LETTER');
-- Names of the keys of the services and of the internal keys (docs/api.md): the only technical names the journal may hold.
CREATE TYPE secret_name AS ENUM (
  'RESEND_API_KEY', 'RESEND_ACCOUNT_API_KEY', 'RESEND_WEBHOOK_SECRET', 'MYSENDINGBOX_API_KEY', 'MYSENDINGBOX_TEST_API_KEY', 'SCW_ACCESS_KEY', 'SCW_SECRET_KEY',
  'OVH_API_APP_KEY', 'OVH_API_APP_SECRET', 'OVH_API_CONSUMER_KEY', 'OVH_SMS_APP_KEY', 'OVH_SMS_APP_SECRET', 'OVH_SMS_CONSUMER_KEY', 'OVH_SMS_SERVICE_NAME',
  'COLLECTION_MAILBOX_PASSWORD', 'TCX_API_CLIENT_ID', 'TCX_API_CLIENT_SECRET', 'AI_API_KEY', 'MAILBOX_SECRETS_KEY', 'ACCESS_CODE_KEY', 'LOOKUP_KEY'
);
CREATE TYPE user_role AS ENUM ('DEVELOPER', 'DIRECTOR', 'COLLECTION_MANAGER', 'CLAIMS_OFFICER', 'CREDITOR');

-- Payload of a task: identifiers, dates, listed codes, yes or no, and numbers too short to be a code.
CREATE FUNCTION app.only_identifiers(payload jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT jsonb_typeof(payload) = 'object' AND NOT EXISTS (
    SELECT 1 FROM jsonb_each(payload) AS entry(name, value)
    WHERE name !~ '^[a-z][A-Za-z]{0,39}$' OR CASE jsonb_typeof(value)
      WHEN 'string' THEN value #>> '{}' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND value #>> '{}' !~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
        AND NOT (value #>> '{}') = ANY (enum_range(NULL::public.task_code)::text[])
      WHEN 'number' THEN value #>> '{}' !~ '^[0-9]{1,3}$'
      WHEN 'boolean' THEN false
      ELSE true
    END
  )
$$;
-- Details of an audit entry: the same, with roles and names of keys. The sentence shown comes from a catalogue, so that
-- no text typed by anyone ever enters the journal.
CREATE FUNCTION app.audit_params(params jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT jsonb_typeof(params) = 'object' AND NOT EXISTS (
    SELECT 1 FROM jsonb_each(params) AS entry(name, value)
    WHERE NOT (
      app.only_identifiers(jsonb_build_object(name, value))
      OR (name ~ '^[a-z][A-Za-z]{0,39}$' AND jsonb_typeof(value) = 'string' AND (
        (value #>> '{}') = ANY (enum_range(NULL::public.user_role)::text[]) OR (value #>> '{}') = ANY (enum_range(NULL::public.secret_name)::text[])))
    )
  )
$$;

-- Enables and forces row-level security, and takes every right back.
CREATE PROCEDURE app.secure(target regclass) LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', target);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', target);
  EXECUTE format('REVOKE ALL ON %s FROM PUBLIC', target);
END
$$;

-- Refuses any change of an append-only table, even by its owner; only the purge of the retention may delete.
CREATE FUNCTION app.refuse_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_user = 'legarec_definer' AND app.setting('purging') = TG_TABLE_NAME THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'append-only table: %', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END
$$;
CREATE PROCEDURE app.append_only(target regclass) LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('CREATE TRIGGER refuse_change BEFORE UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION app.refuse_change()', target);
  EXECUTE format('CREATE TRIGGER refuse_truncate BEFORE TRUNCATE ON %s FOR EACH STATEMENT EXECUTE FUNCTION app.refuse_change()', target);
END
$$;

-- ---------------------------------------------------------------- Types

CREATE TYPE user_status AS ENUM ('INVITED', 'ACTIVE', 'DISABLED');
CREATE TYPE delegation_kind AS ENUM ('TECHNICAL', 'ADMINISTRATIVE');
CREATE TYPE actor_kind AS ENUM ('STAFF', 'CREDITOR', 'DEBTOR', 'SERVICE', 'HOOK', 'SYSTEM', 'ANONYMOUS');
CREATE TYPE creditor_status AS ENUM ('ACTIVE', 'ENDED');
CREATE TYPE debtor_kind AS ENUM ('COMPANY', 'SOLE_TRADER', 'INDIVIDUAL');
CREATE TYPE case_status AS ENUM ('NEW', 'OVERDUE', 'REMINDER', 'FORMAL_NOTICE', 'PROMISE', 'PLAN', 'DISPUTE', 'LITIGATION', 'SETTLED', 'LOST');
CREATE TYPE event_tone AS ENUM ('danger', 'info', 'warning', 'success', 'neutral');
CREATE TYPE webhook_status AS ENUM ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED');

-- ---------------------------------------------------------------- Creditors, accounts, delegations

CREATE TABLE creditors (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  name text NOT NULL CHECK (btrim(name) <> ''),
  siren text UNIQUE CHECK (siren ~ '^[0-9]{9}$'),
  status creditor_status NOT NULL DEFAULT 'ACTIVE',
  portal_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz(3) NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  role user_role NOT NULL,
  status user_status NOT NULL DEFAULT 'INVITED',
  first_name text NOT NULL CHECK (btrim(first_name) <> ''),
  last_name text NOT NULL CHECK (btrim(last_name) <> ''),
  email citext NOT NULL UNIQUE,
  creditor_id uuid REFERENCES creditors (id),
  extension text CHECK (extension ~ '^[0-9]{2,6}$'),
  last_seen_at timestamptz(3),
  disabled_at timestamptz(3),
  disabled_by uuid REFERENCES users (id),
  disabled_reason text,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  -- A creditor account belongs to one creditor, a collaborator to none.
  CONSTRAINT users_creditor CHECK ((role = 'CREDITOR') = (creditor_id IS NOT NULL)),
  CONSTRAINT users_disabled CHECK ((status = 'DISABLED') = (disabled_at IS NOT NULL))
);
-- One holder at most for each single role, even with two requests at the same time.
CREATE UNIQUE INDEX users_single_role ON users (role) WHERE role IN ('DIRECTOR', 'COLLECTION_MANAGER', 'DEVELOPER') AND status <> 'DISABLED';
CREATE INDEX users_creditor_id ON users (creditor_id) WHERE creditor_id IS NOT NULL;

CREATE TABLE delegations (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  kind delegation_kind NOT NULL,
  granted_by uuid NOT NULL REFERENCES users (id),
  granted_at timestamptz(3) NOT NULL DEFAULT now(),
  withdrawn_by uuid REFERENCES users (id),
  withdrawn_at timestamptz(3),
  CONSTRAINT delegations_withdrawn CHECK ((withdrawn_by IS NULL) = (withdrawn_at IS NULL))
);
CREATE UNIQUE INDEX delegations_open ON delegations (kind) WHERE withdrawn_at IS NULL;

-- ---------------------------------------------------------------- Debtors, cases, history

CREATE TABLE debtors (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  kind debtor_kind NOT NULL,
  name text NOT NULL CHECK (btrim(name) <> ''),
  siren text CHECK (siren ~ '^[0-9]{9}$'),
  legal_form_code text,
  legal_form_source text,
  legal_form_checked_at timestamptz(3),
  anonymized_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT debtors_individual CHECK (kind <> 'INDIVIDUAL' OR siren IS NULL)
);
CREATE UNIQUE INDEX debtors_siren ON debtors (siren) WHERE siren IS NOT NULL;

CREATE TABLE cases (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  reference text NOT NULL UNIQUE CHECK (reference ~ '^LGR-[0-9]{4}-[0-9]{5}$'),
  creditor_id uuid NOT NULL REFERENCES creditors (id),
  debtor_id uuid NOT NULL REFERENCES debtors (id),
  officer_id uuid REFERENCES users (id),
  status case_status NOT NULL DEFAULT 'NEW',
  external_reference text,
  -- First letter (postal): no reminder before it, and nothing shown to the debtor.
  first_letter_reference text CHECK (first_letter_reference ~ '^LR-[0-9]{4}-[0-9]{4,}$'),
  first_letter_on date,
  opened_on date NOT NULL DEFAULT ((now() AT TIME ZONE 'Europe/Paris')::date),
  closed_on date,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  -- Target of the composite foreign keys: a child row can never carry the creditor of another case.
  CONSTRAINT cases_id_creditor UNIQUE (id, creditor_id),
  CONSTRAINT cases_first_letter CHECK ((first_letter_reference IS NULL) = (first_letter_on IS NULL)),
  CONSTRAINT cases_closed CHECK ((status IN ('SETTLED', 'LOST')) = (closed_on IS NOT NULL))
);
CREATE UNIQUE INDEX cases_one_open ON cases (creditor_id, debtor_id) WHERE closed_on IS NULL;
CREATE INDEX cases_officer ON cases (officer_id, status);
CREATE INDEX cases_creditor ON cases (creditor_id, status);
CREATE INDEX cases_debtor ON cases (debtor_id);

CREATE TABLE case_events (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  case_id uuid NOT NULL,
  creditor_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  title text NOT NULL,
  detail text,
  tone event_tone NOT NULL DEFAULT 'neutral',
  actor_kind actor_kind NOT NULL,
  actor_id uuid,
  actor_label text NOT NULL,
  on_behalf_of_id uuid REFERENCES users (id),
  visible_to_creditor boolean NOT NULL DEFAULT false,
  occurred_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (case_id, creditor_id) REFERENCES cases (id, creditor_id)
);
CREATE INDEX case_events_case ON case_events (case_id, occurred_at DESC);
CALL app.append_only('case_events');

-- ---------------------------------------------------------------- Platform

CREATE TABLE number_sequences (
  kind text NOT NULL CHECK (kind ~ '^[A-Z][A-Z_]{1,31}$'),
  year integer NOT NULL CHECK (year BETWEEN 2026 AND 9999),
  last_value integer NOT NULL CHECK (last_value > 0),
  PRIMARY KEY (kind, year)
);

CREATE TABLE audit_log (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  occurred_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  actor_kind actor_kind NOT NULL,
  actor_id uuid,
  actor_label text NOT NULL,
  on_behalf_of_id uuid REFERENCES users (id),
  action text NOT NULL CHECK (action ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  entity_type text CHECK (entity_type ~ '^[a-z][a-z_]{1,63}$'),
  entity_id uuid,
  params jsonb NOT NULL DEFAULT '{}' CHECK (app.audit_params(params)),
  ip inet,
  request_id uuid
);
CREATE INDEX audit_log_occurred ON audit_log (occurred_at DESC);
CREATE INDEX audit_log_actor ON audit_log (actor_id, occurred_at DESC);
CALL app.append_only('audit_log');

CREATE TABLE outbox (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  queue text NOT NULL CHECK (queue IN ('email', 'staff-email', 'sms', 'letter', 'pdf', 'imap', 'reminders', 'maintenance')),
  name text NOT NULL CHECK (name ~ '^[a-z][a-z-]{1,63}$'),
  payload jsonb NOT NULL CHECK (app.only_identifiers(payload)),
  -- Who started it, and on behalf of whom: the worker runs it with their rights, checked again.
  actor_kind actor_kind NOT NULL,
  actor_id uuid,
  acting_for delegation_kind,
  run_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  claimed_at timestamptz(3),
  published_at timestamptz(3),
  started_at timestamptz(3),
  done_at timestamptz(3),
  failed_at timestamptz(3),
  failure text CHECK (failure ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  CONSTRAINT outbox_failure CHECK ((failure IS NULL) = (failed_at IS NULL)),
  CONSTRAINT outbox_author CHECK ((actor_kind IN ('STAFF', 'CREDITOR', 'DEBTOR', 'SERVICE')) = (actor_id IS NOT NULL))
);
CREATE INDEX outbox_pending ON outbox (created_at) WHERE published_at IS NULL;
-- A key is used once, even after its task is purged; it is forgotten a year later.
CREATE TABLE task_keys (
  -- The team and the application share theirs; anyone else has their own, and takes nobody else's.
  owner text NOT NULL,
  name text NOT NULL,
  key text NOT NULL CHECK (key ~ '^[a-z][a-z-]{1,30}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(:[0-9]{1,3})?$'),
  task_id uuid NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (owner, name, key)
);

CREATE TABLE webhook_events (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  provider text NOT NULL CHECK (provider ~ '^[A-Z][A-Z0-9_]{1,31}$'),
  provider_event_id text NOT NULL CHECK (length(provider_event_id) BETWEEN 1 AND 200),
  status webhook_status NOT NULL DEFAULT 'RECEIVED',
  received_at timestamptz(3) NOT NULL DEFAULT now(),
  processed_at timestamptz(3),
  UNIQUE (provider, provider_event_id)
);

CREATE TABLE idempotency_keys (
  actor text NOT NULL,
  key uuid NOT NULL,
  route text NOT NULL,
  request_hash bytea NOT NULL,
  status integer,
  -- Encrypted; never a value shown only once.
  result bytea,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (actor, key)
);
CREATE INDEX idempotency_keys_created ON idempotency_keys (created_at);

-- Counts of each purge: what was removed, never what it was.
CREATE TABLE retention_runs (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  kind text NOT NULL CHECK (kind ~ '^[a-z][a-z-]{1,31}$'),
  removed integer NOT NULL CHECK (removed >= 0),
  ran_at timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);

-- ---------------------------------------------------------------- Functions that see more than their caller
-- Owned by legarec_definer: no login, rights limited to the columns below.

GRANT SELECT (id, role, status, first_name, last_name, creditor_id) ON users TO legarec_definer;
GRANT SELECT ON delegations TO legarec_definer;
GRANT SELECT (id, portal_enabled) ON creditors TO legarec_definer;
GRANT SELECT (id, creditor_id, debtor_id, officer_id, first_letter_on, version) ON cases TO legarec_definer;
GRANT UPDATE (officer_id, version) ON cases TO legarec_definer;
GRANT INSERT ON case_events, audit_log, outbox, task_keys TO legarec_definer;
GRANT SELECT (case_id, kind, actor_id, occurred_at) ON case_events TO legarec_definer;
GRANT SELECT (owner, name, key) ON task_keys TO legarec_definer;
GRANT SELECT (id, occurred_at), DELETE ON audit_log TO legarec_definer;
GRANT SELECT, INSERT, UPDATE ON number_sequences TO legarec_definer;

-- Role of the signed-in collaborator, read from the table and never from the request.
CREATE FUNCTION app.staff_role() RETURNS user_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT role FROM public.users WHERE id = app.user_id() AND status = 'ACTIVE' AND role <> 'CREDITOR'
$$;
CREATE FUNCTION app.is_claims_officer(candidate uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.users WHERE id = candidate AND role = 'CLAIMS_OFFICER')
$$;
CREATE FUNCTION app.director_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT id FROM public.users WHERE role = 'DIRECTOR' AND status = 'ACTIVE'
$$;
CREATE FUNCTION app.has_delegation(wanted delegation_kind) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT coalesce(
    app.staff_role() = (CASE wanted WHEN 'TECHNICAL' THEN 'DEVELOPER' WHEN 'ADMINISTRATIVE' THEN 'COLLECTION_MANAGER' END)::public.user_role
    -- Given by the Director in office: the delegations of a former one stop with them.
    AND EXISTS (SELECT 1 FROM public.delegations WHERE kind = wanted AND withdrawn_at IS NULL AND granted_by = app.director_id()), false)
$$;
-- A creditor account only works for its own creditor, whatever the request says.
CREATE FUNCTION app.partner_creditor() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT u.creditor_id FROM public.users u JOIN public.creditors c ON c.id = u.creditor_id
  WHERE u.id = app.user_id() AND u.status = 'ACTIVE' AND u.role = 'CREDITOR' AND u.creditor_id = app.creditor_id() AND c.portal_enabled
$$;
-- The Director, when the current action rests on one of the delegations. Withdrawn meanwhile, it stops the action.
CREATE FUNCTION app.on_behalf_of() RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF app.setting('acting_for') IS NULL THEN
    RETURN NULL;
  END IF;
  IF NOT app.has_delegation(app.setting('acting_for')::public.delegation_kind) THEN
    RAISE EXCEPTION 'delegation withdrawn' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN app.director_id();
END
$$;
-- Read from the role of the transaction, which no variable can imitate. An identity that is no longer recognised
-- (disabled account, closed portal) is nobody.
CREATE FUNCTION app.actor_kind() RETURNS actor_kind LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT (CASE
    WHEN current_setting('role') = 'legarec_staff' AND app.staff_role() IS NOT NULL THEN 'STAFF'
    WHEN current_setting('role') = 'legarec_partner' AND app.partner_creditor() IS NOT NULL THEN 'CREDITOR'
    WHEN current_setting('role') = 'legarec_debtor' AND app.debtor_id() IS NOT NULL THEN 'DEBTOR'
    WHEN current_setting('role') = 'legarec_service' AND app.setting('service') IS NOT NULL THEN 'SERVICE'
    WHEN current_setting('role') = 'legarec_hook' THEN 'HOOK'
    WHEN current_setting('role') IN ('legarec_worker', 'legarec_retention') THEN 'SYSTEM'
    ELSE 'ANONYMOUS'
  END)::public.actor_kind
$$;
-- Name shown in the journals: a debtor or a creditor is never named there.
CREATE FUNCTION app.actor_label() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT CASE app.actor_kind()
    WHEN 'STAFF' THEN (SELECT first_name || ' ' || last_name FROM public.users WHERE id = app.user_id())
    WHEN 'CREDITOR' THEN 'Créancier'
    WHEN 'DEBTOR' THEN 'Débiteur'
    WHEN 'SERVICE' THEN 'Compte de service'
    WHEN 'HOOK' THEN 'Prestataire'
    WHEN 'SYSTEM' THEN 'Application'
    ELSE 'Inconnu'
  END
$$;
CREATE FUNCTION app.actor_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT CASE app.actor_kind() WHEN 'STAFF' THEN app.user_id() WHEN 'CREDITOR' THEN app.user_id() WHEN 'DEBTOR' THEN app.debtor_id() WHEN 'SERVICE' THEN app.setting('service')::uuid END
$$;

-- Case access rules of the team; same rules as canReadCase() and canActOnCase() of packages/contracts.
CREATE FUNCTION app.can_read_case(officer uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(CASE (SELECT app.staff_role())
    WHEN 'DIRECTOR' THEN true
    WHEN 'COLLECTION_MANAGER' THEN officer IS NULL OR officer = app.user_id() OR app.is_claims_officer(officer)
    WHEN 'CLAIMS_OFFICER' THEN officer = app.user_id()
    ELSE false
  END, false)
$$;
CREATE FUNCTION app.can_act_on_case(officer uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(CASE (SELECT app.staff_role())
    WHEN 'DIRECTOR' THEN officer = app.user_id()
    ELSE app.can_read_case(officer)
  END, false)
$$;

-- Single door of the audit log: the actor and « on behalf of » come from the context, never from a parameter.
CREATE FUNCTION app.log(action text, entity_type text, entity_id uuid, params jsonb) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  INSERT INTO public.audit_log (actor_kind, actor_id, actor_label, on_behalf_of_id, action, entity_type, entity_id, params, ip, request_id)
  VALUES (app.actor_kind(), app.actor_id(), app.actor_label(), app.on_behalf_of(), $1, $2, $3, $4, app.setting('ip')::inet, app.setting('request_id')::uuid)
$$;
-- Single door of the history of a case: whoever cannot act on the case cannot write in it.
CREATE FUNCTION app.add_case_event(target uuid, kind text, title text, detail text, tone event_tone, visible_to_creditor boolean) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  owner public.cases.creditor_id%TYPE;
BEGIN
  SELECT c.creditor_id INTO owner FROM public.cases c
  WHERE c.id = target AND (
    app.can_act_on_case(c.officer_id)
    OR c.creditor_id = app.partner_creditor()
    OR (c.debtor_id = app.debtor_id() AND c.first_letter_on IS NOT NULL)
    OR app.actor_kind() = 'SYSTEM'
  );
  IF owner IS NULL THEN
    RAISE EXCEPTION 'case not found' USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO public.case_events (case_id, creditor_id, kind, title, detail, tone, actor_kind, actor_id, actor_label, on_behalf_of_id, visible_to_creditor)
  VALUES (target, owner, kind, title, detail, tone, app.actor_kind(), app.actor_id(), app.actor_label(), app.on_behalf_of(), visible_to_creditor);
END
$$;
-- The only thing written without acting on the case: the Director read a case held by someone else.
CREATE FUNCTION app.note_consultation(target uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  INSERT INTO public.case_events (case_id, creditor_id, kind, title, actor_kind, actor_id, actor_label)
  SELECT c.id, c.creditor_id, 'CASE_VIEWED', 'Dossier consulté', app.actor_kind(), app.actor_id(), app.actor_label()
  FROM public.cases c
  WHERE c.id = target AND app.can_read_case(c.officer_id) AND NOT app.can_act_on_case(c.officer_id)
    -- One line an hour, however many times the screen is refreshed.
    AND NOT EXISTS (
      SELECT 1 FROM public.case_events e
      WHERE e.case_id = target AND e.kind = 'CASE_VIEWED' AND e.actor_id = app.actor_id() AND e.occurred_at > now() - interval '1 hour'
    );
END
$$;
-- Queues a task with the transaction: nothing leaves if it rolls back. False when its key was already used.
CREATE FUNCTION app.enqueue(queue text, name text, payload jsonb, dedupe_key text, run_at timestamptz) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  task constant uuid := app.uuid_v7();
  author constant public.actor_kind := app.actor_kind();
BEGIN
  -- Nobody recognised: the task would otherwise lose its author, and with it the limits of their rights.
  IF author = 'ANONYMOUS' AND current_setting('role') <> 'legarec_auth' THEN
    RAISE EXCEPTION 'unknown author' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF dedupe_key IS NOT NULL THEN
    INSERT INTO public.task_keys (owner, name, key, task_id)
    VALUES (
      CASE
        WHEN author IN ('STAFF', 'SYSTEM') THEN 'team'
        WHEN author = 'CREDITOR' THEN 'creditor:' || app.creditor_id()
        ELSE coalesce(app.actor_key(), lower(author::text))
      END,
      name, dedupe_key, task)
    ON CONFLICT DO NOTHING;
    IF NOT FOUND THEN
      RETURN false;
    END IF;
  END IF;
  INSERT INTO public.outbox (id, queue, name, payload, actor_kind, actor_id, acting_for, run_at)
  VALUES (task, queue, name, payload, author, app.actor_id(), CASE WHEN app.on_behalf_of() IS NOT NULL THEN app.setting('acting_for')::public.delegation_kind END, run_at);
  RETURN true;
END
$$;
-- Yearly counter without any gap: the row stays locked until the end of the transaction. The year is that of Paris.
CREATE FUNCTION app.next_number(wanted text, OUT for_year integer, OUT number integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF app.actor_kind() NOT IN ('STAFF', 'SYSTEM') OR app.staff_role() = 'DEVELOPER' THEN
    RAISE EXCEPTION 'number refused' USING ERRCODE = 'insufficient_privilege';
  END IF;
  for_year := extract(year FROM now() AT TIME ZONE 'Europe/Paris');
  INSERT INTO public.number_sequences AS s (kind, year, last_value) VALUES (wanted, for_year, 1)
  ON CONFLICT (kind, year) DO UPDATE SET last_value = s.last_value + 1
  RETURNING last_value INTO number;
END
$$;
-- Assigns cases: the Director, or the manager on their behalf. Returns the number of cases changed.
CREATE FUNCTION app.assign_cases(targets uuid[], officer uuid) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  changed integer;
BEGIN
  IF app.staff_role() IS DISTINCT FROM 'DIRECTOR' AND (app.setting('acting_for') IS DISTINCT FROM 'ADMINISTRATIVE' OR app.on_behalf_of() IS NULL) THEN
    RAISE EXCEPTION 'assignment refused' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF officer IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.users u WHERE u.id = officer AND u.status = 'ACTIVE' AND u.role IN ('DIRECTOR', 'COLLECTION_MANAGER', 'CLAIMS_OFFICER')
  ) THEN
    RAISE EXCEPTION 'invalid officer' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public.cases c SET officer_id = officer, version = c.version + 1
  WHERE c.id = ANY (targets) AND app.can_read_case(c.officer_id) AND c.officer_id IS DISTINCT FROM officer;
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed;
END
$$;
-- Purge of the retention: one year of audit.
CREATE FUNCTION app.purge_audit() RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  removed integer;
BEGIN
  PERFORM set_config('app.purging', 'audit_log', true);
  DELETE FROM public.audit_log WHERE occurred_at < now() - interval '1 year';
  GET DIAGNOSTICS removed = ROW_COUNT;
  PERFORM set_config('app.purging', '', true);
  RETURN removed;
END
$$;

-- Standard protection of a table attached to a case: it follows the visibility of the case itself.
-- `audiences` lists who else may read it; a column is still invisible until it is granted.
CREATE PROCEDURE app.secure_case_table(target regclass, audiences text[] DEFAULT '{}') LANGUAGE plpgsql AS $$
DECLARE
  audience text;
BEGIN
  CALL app.secure(target);
  EXECUTE format('CREATE POLICY staff_read ON %s FOR SELECT TO legarec_staff USING (case_id IN (SELECT c.id FROM public.cases c))', target);
  EXECUTE format('CREATE POLICY staff_insert ON %s FOR INSERT TO legarec_staff WITH CHECK (case_id IN (SELECT c.id FROM public.cases c WHERE app.can_act_on_case(c.officer_id)))', target);
  EXECUTE format('CREATE POLICY staff_update ON %s FOR UPDATE TO legarec_staff USING (case_id IN (SELECT c.id FROM public.cases c WHERE app.can_act_on_case(c.officer_id))) WITH CHECK (case_id IN (SELECT c.id FROM public.cases c WHERE app.can_act_on_case(c.officer_id)))', target);
  EXECUTE format('CREATE POLICY staff_delete ON %s FOR DELETE TO legarec_staff USING (case_id IN (SELECT c.id FROM public.cases c WHERE app.can_act_on_case(c.officer_id)))', target);
  EXECUTE format('CREATE POLICY worker_all ON %s TO legarec_worker USING (true) WITH CHECK (true)', target);
  FOREACH audience IN ARRAY audiences LOOP
    EXECUTE format('CREATE POLICY %I ON %s FOR SELECT TO %I USING (case_id IN (SELECT c.id FROM public.cases c))', audience || '_read', target, 'legarec_' || audience);
  END LOOP;
END
$$;

-- ---------------------------------------------------------------- Rights on the functions

DO $$
DECLARE
  everyone constant text := 'legarec_auth, legarec_staff, legarec_partner, legarec_debtor, legarec_hook, legarec_service, legarec_worker, legarec_retention, legarec_definer';
BEGIN
  EXECUTE 'GRANT EXECUTE ON FUNCTION app.uuid_v7(), app.setting(text), app.user_id(), app.creditor_id(), app.debtor_id(), app.actor_key(), app.only_identifiers(jsonb), app.audit_params(jsonb) TO ' || everyone;
  EXECUTE 'GRANT EXECUTE ON FUNCTION app.staff_role(), app.has_delegation(delegation_kind), app.partner_creditor(), app.on_behalf_of(), app.actor_kind(), app.actor_label(), app.actor_id() TO ' || everyone;
  EXECUTE 'GRANT EXECUTE ON FUNCTION app.log(text, text, uuid, jsonb), app.enqueue(text, text, jsonb, text, timestamptz) TO ' || everyone;
END
$$;
GRANT EXECUTE ON FUNCTION app.director_id(), app.is_claims_officer(uuid), app.can_read_case(uuid), app.can_act_on_case(uuid) TO legarec_staff, legarec_definer;
GRANT EXECUTE ON FUNCTION app.add_case_event(uuid, text, text, text, event_tone, boolean) TO legarec_staff, legarec_partner, legarec_debtor, legarec_worker;
GRANT EXECUTE ON FUNCTION app.next_number(text) TO legarec_staff, legarec_worker;
GRANT EXECUTE ON FUNCTION app.assign_cases(uuid[], uuid), app.note_consultation(uuid) TO legarec_staff;
GRANT EXECUTE ON FUNCTION app.purge_audit() TO legarec_retention;
-- The owner changes last: the rights granted above stay.
DO $$
DECLARE
  signature text;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'app.staff_role()', 'app.is_claims_officer(uuid)', 'app.director_id()', 'app.has_delegation(delegation_kind)', 'app.partner_creditor()',
    'app.on_behalf_of()', 'app.actor_kind()', 'app.actor_label()', 'app.actor_id()', 'app.log(text, text, uuid, jsonb)',
    'app.add_case_event(uuid, text, text, text, event_tone, boolean)', 'app.enqueue(text, text, jsonb, text, timestamptz)',
    'app.note_consultation(uuid)', 'app.next_number(text)', 'app.assign_cases(uuid[], uuid)', 'app.purge_audit()'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO legarec_definer', signature);
  END LOOP;
END
$$;
REVOKE CREATE ON SCHEMA app FROM legarec_definer;

-- ---------------------------------------------------------------- Policies and rights on the tables

CALL app.secure('creditors');
CALL app.secure('users');
CALL app.secure('delegations');
CALL app.secure('debtors');
CALL app.secure('cases');
CALL app.secure('number_sequences');
CALL app.secure('audit_log');
CALL app.secure('outbox');
CALL app.secure('task_keys');
CALL app.secure('retention_runs');
CALL app.secure('webhook_events');
CALL app.secure('idempotency_keys');
CALL app.secure_case_table('case_events');

-- What the definer functions may touch (the columns are limited above).
CREATE POLICY definer_read ON creditors FOR SELECT TO legarec_definer USING (true);
CREATE POLICY definer_read ON users FOR SELECT TO legarec_definer USING (true);
CREATE POLICY definer_read ON delegations FOR SELECT TO legarec_definer USING (true);
CREATE POLICY definer_read ON cases FOR SELECT TO legarec_definer USING (true);
CREATE POLICY definer_assign ON cases FOR UPDATE TO legarec_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_write ON case_events FOR INSERT TO legarec_definer WITH CHECK (true);
CREATE POLICY definer_write ON audit_log FOR INSERT TO legarec_definer WITH CHECK (true);
CREATE POLICY definer_purge_read ON audit_log FOR SELECT TO legarec_definer USING (true);
CREATE POLICY definer_purge ON audit_log FOR DELETE TO legarec_definer USING (true);
CREATE POLICY definer_write ON outbox FOR INSERT TO legarec_definer WITH CHECK (true);
CREATE POLICY definer_write ON task_keys FOR INSERT TO legarec_definer WITH CHECK (true);
CREATE POLICY definer_read ON task_keys FOR SELECT TO legarec_definer USING (true);
CREATE POLICY definer_read ON case_events FOR SELECT TO legarec_definer USING (true);
CREATE POLICY definer_all ON number_sequences TO legarec_definer USING (true) WITH CHECK (true);

-- Cases: the team by role, a creditor by its own account, a debtor by its own identity.
CREATE POLICY staff_read ON cases FOR SELECT TO legarec_staff USING (app.can_read_case(officer_id));
CREATE POLICY staff_act ON cases FOR UPDATE TO legarec_staff USING (app.can_act_on_case(officer_id)) WITH CHECK (app.can_act_on_case(officer_id));
CREATE POLICY partner_read ON cases FOR SELECT TO legarec_partner USING (creditor_id = (SELECT app.partner_creditor()));
CREATE POLICY debtor_read ON cases FOR SELECT TO legarec_debtor USING (debtor_id = (SELECT app.debtor_id()) AND first_letter_on IS NOT NULL);
CREATE POLICY worker_all ON cases TO legarec_worker USING (true) WITH CHECK (true);
GRANT SELECT (id, reference, creditor_id, debtor_id, officer_id, status, external_reference, first_letter_reference, first_letter_on, opened_on, closed_on, version, created_at) ON cases TO legarec_staff, legarec_worker;
-- Neither the officer, the creditor, the debtor nor the reference of a case can be updated directly. The first letter opens
-- the reminders and the portal of the debtor: only the worker that sent it records it.
GRANT UPDATE (status, external_reference, closed_on, version) ON cases TO legarec_staff, legarec_worker;
GRANT UPDATE (first_letter_reference, first_letter_on) ON cases TO legarec_worker;
GRANT SELECT (id, reference, creditor_id, debtor_id, status, external_reference, opened_on, closed_on) ON cases TO legarec_partner;
GRANT SELECT (id, reference, creditor_id, debtor_id, status, opened_on, closed_on) ON cases TO legarec_debtor;

-- History: what a creditor sees is marked as such; a debtor does not read it.
CREATE POLICY partner_read ON case_events FOR SELECT TO legarec_partner USING (visible_to_creditor AND case_id IN (SELECT c.id FROM cases c));
GRANT SELECT (id, case_id, creditor_id, kind, title, detail, tone, actor_kind, actor_id, actor_label, on_behalf_of_id, visible_to_creditor, occurred_at) ON case_events TO legarec_staff, legarec_worker;
GRANT SELECT (id, case_id, creditor_id, kind, title, detail, tone, actor_kind, actor_label, visible_to_creditor, occurred_at) ON case_events TO legarec_partner;

CREATE POLICY staff_read ON debtors FOR SELECT TO legarec_staff USING (id IN (SELECT c.debtor_id FROM cases c));
CREATE POLICY partner_read ON debtors FOR SELECT TO legarec_partner USING (id IN (SELECT c.debtor_id FROM cases c));
CREATE POLICY debtor_read ON debtors FOR SELECT TO legarec_debtor USING (id = (SELECT app.debtor_id()));
CREATE POLICY worker_all ON debtors TO legarec_worker USING (true) WITH CHECK (true);
GRANT SELECT (id, kind, name, siren, legal_form_code, legal_form_source, legal_form_checked_at, anonymized_at, created_at) ON debtors TO legarec_staff, legarec_worker;
GRANT SELECT (id, kind, name, siren) ON debtors TO legarec_partner, legarec_debtor;

-- Creditors: never the Developer; an officer sees the creditors of their own cases.
CREATE POLICY staff_read ON creditors FOR SELECT TO legarec_staff USING (
  (SELECT app.staff_role()) IN ('DIRECTOR', 'COLLECTION_MANAGER')
  OR ((SELECT app.staff_role()) = 'CLAIMS_OFFICER' AND id IN (SELECT c.creditor_id FROM cases c))
);
CREATE POLICY partner_read ON creditors FOR SELECT TO legarec_partner USING (id = (SELECT app.partner_creditor()));
CREATE POLICY worker_all ON creditors TO legarec_worker USING (true) WITH CHECK (true);
GRANT SELECT (id, name, siren, status, portal_enabled, created_at) ON creditors TO legarec_staff, legarec_worker;
GRANT SELECT (id, name, siren, status) ON creditors TO legarec_partner;

-- Accounts: colleagues see each other; a creditor account is seen with its creditor; a creditor sees itself.
CREATE POLICY staff_read ON users FOR SELECT TO legarec_staff USING (
  (SELECT app.staff_role()) IS NOT NULL AND (role <> 'CREDITOR' OR creditor_id IN (SELECT c.id FROM creditors c))
);
CREATE POLICY partner_read ON users FOR SELECT TO legarec_partner USING (id = (SELECT app.user_id()) AND creditor_id = (SELECT app.partner_creditor()));
CREATE POLICY worker_read ON users FOR SELECT TO legarec_worker USING (true);
GRANT SELECT (id, role, status, first_name, last_name, email, creditor_id, extension, last_seen_at, disabled_at, created_at) ON users TO legarec_staff;
GRANT SELECT (id, role, status, first_name, last_name, email, creditor_id) ON users TO legarec_partner, legarec_worker;

CREATE POLICY staff_read ON delegations FOR SELECT TO legarec_staff USING ((SELECT app.staff_role()) IS NOT NULL);
GRANT SELECT (id, kind, granted_by, granted_at, withdrawn_by, withdrawn_at) ON delegations TO legarec_staff;

-- Audit: read by the Director and the Developer; written by app.log() only.
CREATE POLICY staff_read ON audit_log FOR SELECT TO legarec_staff USING ((SELECT app.staff_role()) IN ('DIRECTOR', 'DEVELOPER'));
GRANT SELECT (id, occurred_at, actor_kind, actor_id, actor_label, on_behalf_of_id, action, entity_type, entity_id, params, ip, request_id) ON audit_log TO legarec_staff;

-- Queues: written by app.enqueue() only, read by the worker.
CREATE POLICY worker_all ON outbox TO legarec_worker USING (true) WITH CHECK (true);
GRANT SELECT (id, queue, name, payload, actor_kind, actor_id, acting_for, run_at, created_at, claimed_at, published_at, started_at, done_at, failed_at, failure), UPDATE (claimed_at, published_at, started_at, done_at, failed_at, failure) ON outbox TO legarec_worker;
CREATE POLICY retention_purge ON outbox TO legarec_retention USING (done_at IS NOT NULL OR failed_at IS NOT NULL);
GRANT SELECT (id, done_at, failed_at), DELETE ON outbox TO legarec_retention;
-- A key outlives its task, but not for ever; that of a task still to come is kept.
CREATE POLICY retention_wait ON outbox FOR SELECT TO legarec_retention USING (true);
CREATE POLICY retention_purge ON task_keys TO legarec_retention USING (true);
GRANT SELECT (task_id, created_at), DELETE ON task_keys TO legarec_retention;
CREATE POLICY retention_write ON retention_runs FOR INSERT TO legarec_retention WITH CHECK (true);
CREATE POLICY staff_read ON retention_runs FOR SELECT TO legarec_staff USING ((SELECT app.staff_role()) IN ('DIRECTOR', 'DEVELOPER'));
GRANT INSERT (kind, removed) ON retention_runs TO legarec_retention;
GRANT SELECT (id, kind, removed, ran_at) ON retention_runs TO legarec_staff;

-- Webhooks: recorded before anyone is identified, handled by the worker.
CREATE POLICY hook_write ON webhook_events FOR INSERT TO legarec_hook WITH CHECK (true);
CREATE POLICY hook_read ON webhook_events FOR SELECT TO legarec_hook USING (true);
CREATE POLICY worker_all ON webhook_events TO legarec_worker USING (true) WITH CHECK (true);
GRANT INSERT (id, provider, provider_event_id), SELECT (id, provider, provider_event_id) ON webhook_events TO legarec_hook;
GRANT SELECT (id, provider, provider_event_id, status, received_at, processed_at), UPDATE (status, processed_at) ON webhook_events TO legarec_worker;
CREATE POLICY retention_purge ON webhook_events TO legarec_retention USING (status <> 'RECEIVED');
GRANT SELECT (id, status, received_at), DELETE ON webhook_events TO legarec_retention;

-- Idempotency: each actor sees its own keys.
CREATE POLICY actor_own ON idempotency_keys TO legarec_staff, legarec_partner, legarec_debtor, legarec_service USING (actor = (SELECT app.actor_key())) WITH CHECK (actor = (SELECT app.actor_key()));
GRANT SELECT (actor, key, route, request_hash, status, result, created_at), INSERT (actor, key, route, request_hash), UPDATE (route, request_hash, status, result, created_at)
  ON idempotency_keys TO legarec_staff, legarec_partner, legarec_debtor, legarec_service;
CREATE POLICY retention_purge ON idempotency_keys TO legarec_retention USING (true);
GRANT SELECT (created_at), DELETE ON idempotency_keys TO legarec_retention;

-- The table of Prisma itself is not an application table: no role reads it.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
