-- Foundation: context of the transaction, single roles, row-level security, append-only journals.
-- Row-level security is enabled and forced on every table; a role sees nothing until a policy says otherwise.

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS btree_gist;

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
  END
$$;

-- Payloads of the queues carry identifiers and codes only: no sentence, address, number or name.
CREATE FUNCTION app.only_identifiers(payload jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT jsonb_typeof(payload) = 'object' AND NOT EXISTS (
    SELECT 1 FROM jsonb_each(payload) AS entry(name, value)
    WHERE CASE jsonb_typeof(value)
      WHEN 'string' THEN value #>> '{}' !~ '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[A-Z][A-Z0-9_]{4,63})$'
      WHEN 'number' THEN value #>> '{}' !~ '^[0-9]{1,6}$'
      WHEN 'boolean' THEN false
      ELSE true
    END
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

CREATE TYPE user_role AS ENUM ('DEVELOPER', 'DIRECTOR', 'COLLECTION_MANAGER', 'CLAIMS_OFFICER', 'CREDITOR');
CREATE TYPE user_status AS ENUM ('INVITED', 'ACTIVE', 'DISABLED');
CREATE TYPE delegation_kind AS ENUM ('TECHNICAL', 'ADMINISTRATIVE');
CREATE TYPE actor_kind AS ENUM ('STAFF', 'CREDITOR', 'DEBTOR', 'SERVICE', 'SYSTEM', 'ANONYMOUS');
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
  summary text NOT NULL CHECK (length(summary) BETWEEN 1 AND 300),
  ip inet,
  request_id uuid
);
CREATE INDEX audit_log_occurred ON audit_log (occurred_at DESC);
CREATE INDEX audit_log_actor ON audit_log (actor_id, occurred_at DESC);
CALL app.append_only('audit_log');

CREATE TABLE outbox (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  queue text NOT NULL CHECK (queue ~ '^[a-z][a-z-]{1,31}$'),
  name text NOT NULL CHECK (name ~ '^[a-z][a-z-]{1,63}$'),
  payload jsonb NOT NULL CHECK (app.only_identifiers(payload)),
  -- Collaborator who started the task: the worker runs it with their rights, checked again.
  actor_id uuid REFERENCES users (id),
  dedupe_key text UNIQUE CHECK (dedupe_key ~ '^[a-z0-9:-]{1,120}$'),
  run_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  published_at timestamptz(3)
);
CREATE INDEX outbox_pending ON outbox (created_at) WHERE published_at IS NULL;

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
  result jsonb,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (actor, key)
);
CREATE INDEX idempotency_keys_created ON idempotency_keys (created_at);

-- ---------------------------------------------------------------- Functions that see more than their caller
-- Owned by legarec_definer: no login, rights limited to the columns below.

GRANT SELECT (id, role, status, first_name, last_name, creditor_id) ON users TO legarec_definer;
GRANT SELECT ON delegations TO legarec_definer;
GRANT SELECT (id, name) ON creditors TO legarec_definer;
GRANT SELECT (id, creditor_id, debtor_id, officer_id, first_letter_on, version) ON cases TO legarec_definer;
GRANT UPDATE (officer_id, version) ON cases TO legarec_definer;
GRANT INSERT ON case_events, audit_log, outbox TO legarec_definer;
GRANT SELECT (dedupe_key) ON outbox TO legarec_definer;
GRANT SELECT (id, occurred_at), DELETE ON audit_log TO legarec_definer;
GRANT SELECT, INSERT, UPDATE ON number_sequences TO legarec_definer;

-- Role of the signed-in collaborator, read from the table and never from the request.
CREATE FUNCTION app.staff_role() RETURNS user_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT role FROM public.users WHERE id = app.user_id() AND status = 'ACTIVE' AND role <> 'CREDITOR'
$$;
CREATE FUNCTION app.is_claims_officer(candidate uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (SELECT 1 FROM public.users WHERE id = candidate AND role = 'CLAIMS_OFFICER')
$$;
CREATE FUNCTION app.director_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT id FROM public.users WHERE role = 'DIRECTOR' AND status = 'ACTIVE'
$$;
CREATE FUNCTION app.has_delegation(wanted delegation_kind) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT coalesce(
    app.staff_role() = (CASE wanted WHEN 'TECHNICAL' THEN 'DEVELOPER' WHEN 'ADMINISTRATIVE' THEN 'COLLECTION_MANAGER' END)::public.user_role
    AND EXISTS (SELECT 1 FROM public.delegations WHERE kind = wanted AND withdrawn_at IS NULL), false)
$$;
-- A creditor account only works for its own creditor, whatever the request says.
CREATE FUNCTION app.partner_creditor() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT creditor_id FROM public.users WHERE id = app.user_id() AND status = 'ACTIVE' AND role = 'CREDITOR' AND creditor_id = app.creditor_id()
$$;
-- The Director, when the current action rests on one of the delegations, checked again here.
CREATE FUNCTION app.on_behalf_of() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT CASE WHEN app.setting('acting_for') IS NOT NULL AND app.has_delegation(app.setting('acting_for')::public.delegation_kind) THEN app.director_id() END
$$;
CREATE FUNCTION app.actor_kind() RETURNS actor_kind LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT (CASE
    WHEN app.staff_role() IS NOT NULL THEN 'STAFF'
    WHEN app.partner_creditor() IS NOT NULL THEN 'CREDITOR'
    WHEN app.debtor_id() IS NOT NULL THEN 'DEBTOR'
    WHEN app.setting('service') IS NOT NULL THEN 'SERVICE'
    WHEN app.setting('job') IS NOT NULL THEN 'SYSTEM'
    ELSE 'ANONYMOUS'
  END)::public.actor_kind
$$;
-- Name shown in the journals: a debtor or a creditor is never named there.
CREATE FUNCTION app.actor_label() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT CASE app.actor_kind()
    WHEN 'STAFF' THEN (SELECT first_name || ' ' || last_name FROM public.users WHERE id = app.user_id())
    WHEN 'CREDITOR' THEN 'Créancier'
    WHEN 'DEBTOR' THEN 'Débiteur'
    WHEN 'SERVICE' THEN 'Compte de service'
    WHEN 'SYSTEM' THEN 'Application'
    ELSE 'Inconnu'
  END
$$;
CREATE FUNCTION app.actor_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT CASE app.actor_kind() WHEN 'STAFF' THEN app.user_id() WHEN 'CREDITOR' THEN app.user_id() WHEN 'DEBTOR' THEN app.debtor_id() END
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
CREATE FUNCTION app.log(action text, entity_type text, entity_id uuid, summary text) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  INSERT INTO public.audit_log (actor_kind, actor_id, actor_label, on_behalf_of_id, action, entity_type, entity_id, summary, ip, request_id)
  VALUES (app.actor_kind(), app.actor_id(), app.actor_label(), app.on_behalf_of(), $1, $2, $3, $4, app.setting('ip')::inet, app.setting('request_id')::uuid)
$$;
-- Single door of the history of a case: whoever cannot act on the case cannot write in it.
CREATE FUNCTION app.add_case_event(target uuid, kind text, title text, detail text, tone event_tone, visible_to_creditor boolean) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
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
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  INSERT INTO public.case_events (case_id, creditor_id, kind, title, actor_kind, actor_id, actor_label)
  SELECT c.id, c.creditor_id, 'CASE_VIEWED', 'Dossier consulté', app.actor_kind(), app.actor_id(), app.actor_label()
  FROM public.cases c
  WHERE c.id = target AND app.can_read_case(c.officer_id) AND NOT app.can_act_on_case(c.officer_id);
END
$$;
-- Queues a task with the transaction: nothing leaves if it rolls back.
CREATE FUNCTION app.enqueue(queue text, name text, payload jsonb, dedupe_key text, run_at timestamptz) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  INSERT INTO public.outbox (queue, name, payload, actor_id, dedupe_key, run_at)
  VALUES ($1, $2, $3, CASE WHEN app.staff_role() IS NOT NULL THEN app.user_id() END, $4, $5)
  ON CONFLICT (dedupe_key) DO NOTHING
$$;
-- Yearly counter without any gap: the row stays locked until the end of the transaction.
CREATE FUNCTION app.next_number(wanted text, for_year integer) RETURNS integer
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  INSERT INTO public.number_sequences AS s (kind, year, last_value) VALUES (wanted, for_year, 1)
  ON CONFLICT (kind, year) DO UPDATE SET last_value = s.last_value + 1
  RETURNING last_value
$$;
-- Assigns cases: the Director, or the manager with the administrative delegation. Returns the number of cases changed.
CREATE FUNCTION app.assign_cases(targets uuid[], officer uuid) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  changed integer;
BEGIN
  IF app.staff_role() IS DISTINCT FROM 'DIRECTOR' AND NOT app.has_delegation('ADMINISTRATIVE') THEN
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
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
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
  EXECUTE 'GRANT EXECUTE ON FUNCTION app.uuid_v7(), app.setting(text), app.user_id(), app.creditor_id(), app.debtor_id(), app.actor_key(), app.only_identifiers(jsonb) TO ' || everyone;
  EXECUTE 'GRANT EXECUTE ON FUNCTION app.staff_role(), app.has_delegation(delegation_kind), app.partner_creditor(), app.on_behalf_of(), app.actor_kind(), app.actor_label(), app.actor_id() TO ' || everyone;
  EXECUTE 'GRANT EXECUTE ON FUNCTION app.log(text, text, uuid, text), app.enqueue(text, text, jsonb, text, timestamptz) TO ' || everyone;
END
$$;
GRANT EXECUTE ON FUNCTION app.director_id(), app.is_claims_officer(uuid), app.can_read_case(uuid), app.can_act_on_case(uuid) TO legarec_staff, legarec_definer;
GRANT EXECUTE ON FUNCTION app.add_case_event(uuid, text, text, text, event_tone, boolean) TO legarec_staff, legarec_partner, legarec_debtor, legarec_worker;
GRANT EXECUTE ON FUNCTION app.next_number(text, integer) TO legarec_staff, legarec_worker;
GRANT EXECUTE ON FUNCTION app.assign_cases(uuid[], uuid), app.note_consultation(uuid) TO legarec_staff;
GRANT EXECUTE ON FUNCTION app.purge_audit() TO legarec_retention;
-- The owner changes last: the rights granted above stay.
DO $$
DECLARE
  signature text;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'app.staff_role()', 'app.is_claims_officer(uuid)', 'app.director_id()', 'app.has_delegation(delegation_kind)', 'app.partner_creditor()',
    'app.on_behalf_of()', 'app.actor_kind()', 'app.actor_label()', 'app.actor_id()', 'app.log(text, text, uuid, text)',
    'app.add_case_event(uuid, text, text, text, event_tone, boolean)', 'app.enqueue(text, text, jsonb, text, timestamptz)',
    'app.note_consultation(uuid)', 'app.next_number(text, integer)', 'app.assign_cases(uuid[], uuid)', 'app.purge_audit()'
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
CREATE POLICY definer_read ON outbox FOR SELECT TO legarec_definer USING (true);
CREATE POLICY definer_all ON number_sequences TO legarec_definer USING (true) WITH CHECK (true);

-- Cases: the team by role, a creditor by its own account, a debtor by its own identity.
CREATE POLICY staff_read ON cases FOR SELECT TO legarec_staff USING (app.can_read_case(officer_id));
CREATE POLICY staff_act ON cases FOR UPDATE TO legarec_staff USING (app.can_act_on_case(officer_id)) WITH CHECK (app.can_act_on_case(officer_id));
CREATE POLICY partner_read ON cases FOR SELECT TO legarec_partner USING (creditor_id = (SELECT app.partner_creditor()));
CREATE POLICY debtor_read ON cases FOR SELECT TO legarec_debtor USING (debtor_id = (SELECT app.debtor_id()) AND first_letter_on IS NOT NULL);
CREATE POLICY worker_all ON cases TO legarec_worker USING (true) WITH CHECK (true);
GRANT SELECT ON cases TO legarec_staff, legarec_worker;
-- Neither the owner, the creditor, the debtor nor the reference of a case can be updated directly.
GRANT UPDATE (status, external_reference, first_letter_reference, first_letter_on, closed_on, version) ON cases TO legarec_staff, legarec_worker;
GRANT SELECT (id, reference, creditor_id, debtor_id, status, external_reference, opened_on, closed_on) ON cases TO legarec_partner;
GRANT SELECT (id, reference, creditor_id, debtor_id, status, opened_on, closed_on) ON cases TO legarec_debtor;

-- History: what a creditor sees is marked as such; a debtor does not read it.
CREATE POLICY partner_read ON case_events FOR SELECT TO legarec_partner USING (visible_to_creditor AND case_id IN (SELECT c.id FROM cases c));
GRANT SELECT ON case_events TO legarec_staff, legarec_worker;
GRANT SELECT (id, case_id, creditor_id, kind, title, detail, tone, actor_kind, actor_label, visible_to_creditor, occurred_at) ON case_events TO legarec_partner;

CREATE POLICY staff_read ON debtors FOR SELECT TO legarec_staff USING (id IN (SELECT c.debtor_id FROM cases c));
CREATE POLICY partner_read ON debtors FOR SELECT TO legarec_partner USING (id IN (SELECT c.debtor_id FROM cases c));
CREATE POLICY debtor_read ON debtors FOR SELECT TO legarec_debtor USING (id = (SELECT app.debtor_id()));
CREATE POLICY worker_all ON debtors TO legarec_worker USING (true) WITH CHECK (true);
GRANT SELECT ON debtors TO legarec_staff, legarec_worker;
GRANT SELECT (id, kind, name, siren) ON debtors TO legarec_partner, legarec_debtor;

-- Creditors: never the Developer; an officer sees the creditors of their own cases.
CREATE POLICY staff_read ON creditors FOR SELECT TO legarec_staff USING (
  (SELECT app.staff_role()) IN ('DIRECTOR', 'COLLECTION_MANAGER')
  OR ((SELECT app.staff_role()) = 'CLAIMS_OFFICER' AND id IN (SELECT c.creditor_id FROM cases c))
);
CREATE POLICY partner_read ON creditors FOR SELECT TO legarec_partner USING (id = (SELECT app.partner_creditor()));
CREATE POLICY worker_all ON creditors TO legarec_worker USING (true) WITH CHECK (true);
GRANT SELECT ON creditors TO legarec_staff, legarec_worker;
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
GRANT SELECT ON delegations TO legarec_staff;

-- Audit: read by the Director and the Developer; written by app.log() only.
CREATE POLICY staff_read ON audit_log FOR SELECT TO legarec_staff USING ((SELECT app.staff_role()) IN ('DIRECTOR', 'DEVELOPER'));
GRANT SELECT ON audit_log TO legarec_staff;

-- Queues: written by app.enqueue() only, read by the worker.
CREATE POLICY worker_all ON outbox TO legarec_worker USING (true) WITH CHECK (true);
GRANT SELECT, UPDATE (published_at) ON outbox TO legarec_worker;
CREATE POLICY retention_purge ON outbox TO legarec_retention USING (published_at IS NOT NULL);
GRANT SELECT (id, published_at), DELETE ON outbox TO legarec_retention;

-- Webhooks: recorded before anyone is identified, handled by the worker.
CREATE POLICY hook_write ON webhook_events FOR INSERT TO legarec_hook WITH CHECK (true);
CREATE POLICY hook_read ON webhook_events FOR SELECT TO legarec_hook USING (true);
CREATE POLICY worker_all ON webhook_events TO legarec_worker USING (true) WITH CHECK (true);
GRANT INSERT (id, provider, provider_event_id), SELECT (id, provider, provider_event_id) ON webhook_events TO legarec_hook;
GRANT SELECT, UPDATE (status, processed_at) ON webhook_events TO legarec_worker;
CREATE POLICY retention_purge ON webhook_events TO legarec_retention USING (status <> 'RECEIVED');
GRANT SELECT (id, status, received_at), DELETE ON webhook_events TO legarec_retention;

-- Idempotency: each actor sees its own keys.
CREATE POLICY actor_own ON idempotency_keys TO legarec_staff, legarec_partner, legarec_debtor USING (actor = (SELECT app.actor_key())) WITH CHECK (actor = (SELECT app.actor_key()));
GRANT SELECT, INSERT, UPDATE (status, result) ON idempotency_keys TO legarec_staff, legarec_partner, legarec_debtor;
CREATE POLICY retention_purge ON idempotency_keys TO legarec_retention USING (true);
GRANT SELECT (created_at), DELETE ON idempotency_keys TO legarec_retention;

-- The table of Prisma itself is not an application table: no role reads it.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
