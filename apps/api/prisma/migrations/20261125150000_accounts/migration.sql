-- Accounts: sign-in, sessions, second factors, invitations, support, delegations.
-- Credentials belong to legarec_auth alone, and one account at a time: a transaction of the sign-in names its account
-- (`app.subject`) and sees nothing of the others. What is done to someone else's account goes through a function that
-- checks who is acting, closes what must be closed and tells the Director.

-- ---------------------------------------------------------------- Types

CREATE TYPE account_portal AS ENUM ('STAFF', 'PARTNER');
CREATE TYPE user_theme AS ENUM ('light', 'dark', 'system');
CREATE TYPE user_density AS ENUM ('comfortable', 'compact');
CREATE TYPE factor_kind AS ENUM ('TOTP', 'WEBAUTHN');
CREATE TYPE token_purpose AS ENUM ('INVITATION', 'RESET', 'WEBAUTHN');
CREATE TYPE attempt_scope AS ENUM ('SIGN_IN', 'SECOND_FACTOR', 'PASSWORD');
CREATE TYPE ticket_status AS ENUM ('OPEN', 'CLOSED');
CREATE TYPE request_status AS ENUM ('OPEN', 'DONE', 'CANCELLED');
CREATE TYPE notification_kind AS ENUM ('SUPPORT_ACTION', 'SUPPORT_TICKET', 'PASSWORD_RESET', 'DELEGATION_ENDED', 'DEVELOPER_CHANGED');
-- What the support does to an account; the sentence shown comes from a catalogue.
CREATE TYPE support_action AS ENUM ('RESET_LINK', 'SECOND_FACTOR_REQUIRED', 'SECOND_FACTOR_RESET', 'ACCOUNT_UNLOCKED');

-- ---------------------------------------------------------------- Tables

ALTER TABLE users
  ADD COLUMN password_hash text,
  ADD COLUMN password_changed_at timestamptz(3),
  ADD COLUMN two_factor_required boolean NOT NULL DEFAULT false,
  ADD COLUMN theme user_theme NOT NULL DEFAULT 'light',
  ADD COLUMN density user_density NOT NULL DEFAULT 'comfortable',
  ADD COLUMN low_vision boolean NOT NULL DEFAULT false,
  ADD COLUMN daily_summary boolean NOT NULL DEFAULT true,
  ADD COLUMN quiet_hours boolean NOT NULL DEFAULT true,
  ADD COLUMN substitute_id uuid REFERENCES users (id),
  ADD COLUMN absent_from date,
  ADD COLUMN absent_until date,
  ADD COLUMN auto_reply boolean NOT NULL DEFAULT false,
  ADD COLUMN invited_by uuid REFERENCES users (id),
  ADD COLUMN invited_at timestamptz(3),
  ADD COLUMN anonymized_at timestamptz(3),
  ADD CONSTRAINT users_absence CHECK (absent_from IS NULL OR absent_until IS NULL OR absent_from <= absent_until),
  ADD CONSTRAINT users_substitute CHECK (substitute_id <> id);

-- Always required of the Developer, however the account or its role came about.
CREATE FUNCTION app.require_for_developer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.two_factor_required := NEW.two_factor_required OR NEW.role = 'DEVELOPER';
  RETURN NEW;
END
$$;
CREATE TRIGGER users_two_factor BEFORE INSERT OR UPDATE ON users FOR EACH ROW EXECUTE FUNCTION app.require_for_developer();
CREATE FUNCTION app.refuse(code text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'refused' USING ERRCODE = code;
END
$$;

-- A browser already seen, so that an unknown one is told to the holder. It opens nothing.
CREATE TABLE user_devices (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  user_id uuid NOT NULL REFERENCES users (id),
  token_hash bytea NOT NULL,
  label text NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  last_seen_at timestamptz(3) NOT NULL DEFAULT now(),
  expires_at timestamptz(3) NOT NULL,
  UNIQUE (user_id, token_hash)
);

CREATE TABLE user_sessions (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  user_id uuid NOT NULL REFERENCES users (id),
  portal account_portal NOT NULL,
  token_hash bytea NOT NULL UNIQUE,
  device_label text NOT NULL,
  mobile boolean NOT NULL DEFAULT false,
  ip inet,
  -- Decided when signing in: what is required later applies to the next sign-in.
  second_factor_needed boolean NOT NULL,
  second_factor_at timestamptz(3),
  persistent boolean NOT NULL DEFAULT false,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  -- Last proof of identity: password or second factor.
  proved_at timestamptz(3) NOT NULL DEFAULT now(),
  last_seen_at timestamptz(3) NOT NULL DEFAULT now(),
  expires_at timestamptz(3) NOT NULL,
  revoked_at timestamptz(3)
);
CREATE INDEX user_sessions_user ON user_sessions (user_id) WHERE revoked_at IS NULL;

CREATE TABLE second_factors (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  user_id uuid NOT NULL REFERENCES users (id),
  kind factor_kind NOT NULL,
  -- TOTP: encrypted, with the last step accepted so that a code is never used twice.
  secret_cipher bytea,
  last_step integer,
  -- Security key.
  credential_id text UNIQUE,
  public_key bytea,
  sign_count bigint,
  transports text,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  confirmed_at timestamptz(3),
  last_used_at timestamptz(3),
  CONSTRAINT second_factors_kind CHECK (
    CASE kind
      WHEN 'TOTP' THEN secret_cipher IS NOT NULL AND credential_id IS NULL AND public_key IS NULL
      ELSE secret_cipher IS NULL AND credential_id IS NOT NULL AND public_key IS NOT NULL AND sign_count IS NOT NULL AND confirmed_at IS NOT NULL
    END)
);
-- One application at most, and one being set up.
CREATE UNIQUE INDEX second_factors_totp ON second_factors (user_id, (confirmed_at IS NULL)) WHERE kind = 'TOTP';
CREATE INDEX second_factors_user ON second_factors (user_id);

CREATE TABLE backup_codes (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  user_id uuid NOT NULL REFERENCES users (id),
  code_hash text NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  used_at timestamptz(3)
);
CREATE INDEX backup_codes_user ON backup_codes (user_id);

CREATE TABLE auth_tokens (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  purpose token_purpose NOT NULL,
  user_id uuid NOT NULL REFERENCES users (id),
  -- Challenge of a security key: for that session only.
  session_id uuid REFERENCES user_sessions (id),
  token_hash bytea NOT NULL UNIQUE,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  expires_at timestamptz(3) NOT NULL,
  -- Invitation: the password is chosen, the second factor may still be set up.
  opened_at timestamptz(3),
  used_at timestamptz(3)
);
CREATE INDEX auth_tokens_user ON auth_tokens (user_id) WHERE used_at IS NULL;

-- Failures by account or by unknown identifier: the key is a keyed digest, so that nobody is named here.
CREATE TABLE lockouts (
  key_hash bytea PRIMARY KEY,
  scope attempt_scope NOT NULL,
  failures integer NOT NULL,
  last_failure_at timestamptz(3) NOT NULL DEFAULT now(),
  locked_until timestamptz(3)
);

CREATE TABLE notification_preferences (
  user_id uuid NOT NULL REFERENCES users (id),
  kind text NOT NULL CHECK (kind ~ '^[a-z][a-z-]{1,31}$'),
  in_app boolean NOT NULL,
  email boolean NOT NULL,
  PRIMARY KEY (user_id, kind)
);

-- Facts only: the sentence is written when it is read, with the rights of the reader.
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  user_id uuid NOT NULL REFERENCES users (id),
  kind notification_kind NOT NULL,
  action support_action,
  actor_id uuid REFERENCES users (id),
  target_id uuid REFERENCES users (id),
  ticket_id uuid,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  read_at timestamptz(3),
  CONSTRAINT notifications_facts CHECK (
    actor_id IS NOT NULL AND CASE kind
      WHEN 'SUPPORT_ACTION' THEN action IS NOT NULL AND target_id IS NOT NULL
      WHEN 'SUPPORT_TICKET' THEN ticket_id IS NOT NULL
      ELSE target_id IS NOT NULL
    END)
);
CREATE INDEX notifications_user ON notifications (user_id, created_at DESC);

CREATE TABLE support_tickets (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  number text NOT NULL UNIQUE CHECK (number ~ '^[0-9]{4}-[0-9]{4,}$'),
  user_id uuid NOT NULL REFERENCES users (id),
  subject text NOT NULL CHECK (length(subject) <= 200),
  message text NOT NULL CHECK (length(message) BETWEEN 1 AND 5000),
  status ticket_status NOT NULL DEFAULT 'OPEN',
  created_at timestamptz(3) NOT NULL DEFAULT now()
);
ALTER TABLE notifications ADD FOREIGN KEY (ticket_id) REFERENCES support_tickets (id);

-- Mailbox to create for an invited collaborator: the invitation leaves once it exists.
CREATE TABLE mailbox_requests (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  user_id uuid NOT NULL REFERENCES users (id),
  local text NOT NULL CHECK (local ~ '^[a-z0-9.-]{1,64}$'),
  requested_by uuid NOT NULL REFERENCES users (id),
  status request_status NOT NULL DEFAULT 'OPEN',
  decided_by uuid REFERENCES users (id),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  decided_at timestamptz(3)
);
CREATE UNIQUE INDEX mailbox_requests_open ON mailbox_requests (user_id) WHERE status = 'OPEN';

-- ---------------------------------------------------------------- Values of the journal

-- Delegations join the roles and the names of the keys.
CREATE OR REPLACE FUNCTION app.audit_params(params jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT jsonb_typeof(params) = 'object' AND NOT EXISTS (
    SELECT 1 FROM jsonb_each(params) AS entry(name, value)
    WHERE NOT (
      app.only_identifiers(jsonb_build_object(name, value))
      OR (name ~ '^[a-z][A-Za-z]{0,39}$' AND jsonb_typeof(value) = 'string' AND (
        (value #>> '{}') = ANY (enum_range(NULL::public.user_role)::text[]) OR (value #>> '{}') = ANY (enum_range(NULL::public.secret_name)::text[])
        OR (value #>> '{}') = ANY (enum_range(NULL::public.delegation_kind)::text[])))
    )
  )
$$;

-- ---------------------------------------------------------------- Account of a transaction of the sign-in

CREATE FUNCTION app.subject() RETURNS uuid LANGUAGE sql STABLE PARALLEL SAFE AS $$ SELECT app.setting('subject')::uuid $$;
-- The same, once that account has shown who it is: nothing is written before.
CREATE FUNCTION app.proved_subject() RETURNS uuid LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN app.setting('proved') IS NOT NULL THEN app.subject() END
$$;

-- The functions below are owned by legarec_definer, with these rights and no other.
GRANT CREATE ON SCHEMA app TO legarec_definer;
GRANT EXECUTE ON FUNCTION app.subject(), app.proved_subject() TO legarec_auth, legarec_definer;
GRANT EXECUTE ON FUNCTION app.refuse(text) TO legarec_definer;
GRANT SELECT (email, password_hash, two_factor_required, invited_by, invited_at, substitute_id, disabled_at, anonymized_at),
  INSERT (role, first_name, last_name, email, creditor_id, invited_by, invited_at),
  UPDATE (role, status, first_name, last_name, email, extension, password_hash, two_factor_required, last_seen_at, substitute_id, invited_at, disabled_at, disabled_by, disabled_reason, anonymized_at),
  DELETE ON users TO legarec_definer;
GRANT SELECT (id, user_id, portal, token_hash, second_factor_needed, second_factor_at, proved_at, last_seen_at, expires_at, revoked_at), UPDATE (last_seen_at, revoked_at), DELETE ON user_sessions TO legarec_definer;
GRANT SELECT (id, user_id, purpose, session_id, token_hash, expires_at, opened_at, used_at), UPDATE (used_at), DELETE ON auth_tokens TO legarec_definer;
GRANT SELECT (user_id, confirmed_at), DELETE ON second_factors TO legarec_definer;
GRANT SELECT (user_id), DELETE ON backup_codes, notification_preferences TO legarec_definer;
GRANT SELECT (user_id, expires_at), DELETE ON user_devices TO legarec_definer;
GRANT SELECT, INSERT, UPDATE, DELETE ON lockouts TO legarec_definer;
GRANT SELECT (user_id), INSERT (user_id, kind, action, actor_id, target_id, ticket_id), DELETE ON notifications TO legarec_definer;
GRANT SELECT (id, user_id), INSERT (id, number, user_id, subject, message) ON support_tickets TO legarec_definer;
GRANT SELECT (user_id), INSERT (user_id, local, requested_by), DELETE ON mailbox_requests TO legarec_definer;
GRANT INSERT (kind, granted_by), UPDATE (withdrawn_by, withdrawn_at) ON delegations TO legarec_definer;

SET LOCAL ROLE legarec_definer;
-- As for the owner: a new function is never callable by everyone.
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- An account that has just proved who it is, before any session exists, signs its own actions.
CREATE OR REPLACE FUNCTION app.actor_kind() RETURNS actor_kind LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT coalesce(CASE
    WHEN current_setting('role') = 'legarec_staff' AND app.staff_role() IS NOT NULL THEN 'STAFF'
    WHEN current_setting('role') = 'legarec_partner' AND app.partner_creditor() IS NOT NULL THEN 'CREDITOR'
    WHEN current_setting('role') = 'legarec_debtor' AND app.debtor_id() IS NOT NULL THEN 'DEBTOR'
    WHEN current_setting('role') = 'legarec_service' AND app.setting('service') IS NOT NULL THEN 'SERVICE'
    WHEN current_setting('role') = 'legarec_hook' THEN 'HOOK'
    WHEN current_setting('role') IN ('legarec_worker', 'legarec_retention') THEN 'SYSTEM'
    WHEN current_setting('role') = 'legarec_auth' THEN
      (SELECT CASE WHEN role = 'CREDITOR' THEN 'CREDITOR' ELSE 'STAFF' END FROM public.users WHERE id = app.proved_subject() AND status = 'ACTIVE')
  END, 'ANONYMOUS')::public.actor_kind
$$;
CREATE OR REPLACE FUNCTION app.actor_label() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT CASE app.actor_kind()
    WHEN 'STAFF' THEN (SELECT first_name || ' ' || last_name FROM public.users WHERE id = app.actor_id())
    WHEN 'CREDITOR' THEN 'Créancier'
    WHEN 'DEBTOR' THEN 'Débiteur'
    WHEN 'SERVICE' THEN 'Compte de service'
    WHEN 'HOOK' THEN 'Prestataire'
    WHEN 'SYSTEM' THEN 'Application'
    ELSE 'Inconnu'
  END
$$;
CREATE OR REPLACE FUNCTION app.actor_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT CASE app.actor_kind()
    WHEN 'STAFF' THEN coalesce(app.user_id(), app.proved_subject())
    WHEN 'CREDITOR' THEN coalesce(app.user_id(), app.proved_subject())
    WHEN 'DEBTOR' THEN app.debtor_id()
    WHEN 'SERVICE' THEN app.setting('service')::uuid
  END
$$;

-- ---------------------------------------------------------------- Finding an account: the sign-in only

CREATE FUNCTION app.account_of(wanted citext) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT u.id FROM public.users u LEFT JOIN public.creditors c ON c.id = u.creditor_id
  WHERE u.email = wanted AND u.status = 'ACTIVE' AND u.password_hash IS NOT NULL AND (u.role <> 'CREDITOR' OR c.portal_enabled)
$$;
-- Digests travel in hexadecimal.
CREATE FUNCTION app.digests(hexadecimal text[]) RETURNS bytea[] LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, pg_temp AS $$
  SELECT ARRAY(SELECT decode(digest, 'hex') FROM unnest(hexadecimal) AS digest)
$$;
-- Live link of an invitation or of a reset.
CREATE FUNCTION app.account_of_link(wanted token_purpose, hashes text[]) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT t.user_id FROM public.auth_tokens t JOIN public.users u ON u.id = t.user_id LEFT JOIN public.creditors c ON c.id = u.creditor_id
  WHERE t.purpose = wanted AND t.token_hash = ANY (app.digests(hashes)) AND t.used_at IS NULL AND t.expires_at > now() AND (u.role <> 'CREDITOR' OR c.portal_enabled)
    AND u.status = (CASE WHEN wanted = 'INVITATION' AND t.opened_at IS NULL THEN 'INVITED' ELSE 'ACTIVE' END)::public.user_status
$$;
CREATE FUNCTION app.inviter_name() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT i.first_name || ' ' || i.last_name FROM public.users u JOIN public.users i ON i.id = u.invited_by WHERE u.id = app.subject()
$$;
-- Session of a cookie, with the account as it is now. Thirty minutes without anything asked by its holder close it: what
-- the screen asks by itself does not count.
CREATE FUNCTION app.resume_session(wanted account_portal, hashes text[], background boolean)
RETURNS TABLE (session_id uuid, user_id uuid, role user_role, creditor_id uuid, complete boolean, proved_at timestamptz, second_factor boolean, delegations text[])
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  known record;
BEGIN
  SELECT s.id, s.user_id, u.role, u.creditor_id, (NOT s.second_factor_needed OR s.second_factor_at IS NOT NULL) AS complete, s.proved_at, s.last_seen_at INTO known
  FROM public.user_sessions s JOIN public.users u ON u.id = s.user_id LEFT JOIN public.creditors c ON c.id = u.creditor_id
  WHERE s.token_hash = ANY (app.digests(hashes)) AND s.portal = wanted AND s.revoked_at IS NULL AND s.expires_at > now() AND s.last_seen_at > now() - interval '30 minutes'
    AND u.status = 'ACTIVE' AND (wanted = 'STAFF') = (u.role <> 'CREDITOR') AND (u.role <> 'CREDITOR' OR c.portal_enabled);
  IF NOT FOUND THEN
    RETURN;
  END IF;
  -- Once a minute is enough. The account, then its sessions: the same order as whatever closes them.
  IF known.complete AND NOT background AND known.last_seen_at < now() - interval '1 minute' THEN
    UPDATE public.users u SET last_seen_at = now() WHERE u.id = known.user_id AND u.status = 'ACTIVE' AND u.role = known.role;
    IF NOT FOUND THEN
      RETURN;
    END IF;
    UPDATE public.user_sessions s SET last_seen_at = now() WHERE s.id = known.id AND s.revoked_at IS NULL;
    IF NOT FOUND THEN
      RETURN;
    END IF;
  END IF;
  RETURN QUERY SELECT known.id, known.user_id, known.role, known.creditor_id, known.complete, known.proved_at,
    EXISTS (SELECT 1 FROM public.second_factors f WHERE f.user_id = known.user_id AND f.confirmed_at IS NOT NULL), ARRAY(
    SELECT d.kind::text FROM public.delegations d
    WHERE d.withdrawn_at IS NULL AND d.granted_by = app.director_id()
      AND known.role = (CASE d.kind WHEN 'TECHNICAL' THEN 'DEVELOPER' WHEN 'ADMINISTRATIVE' THEN 'COLLECTION_MANAGER' END)::public.user_role
    ORDER BY 1);
END
$$;

-- ---------------------------------------------------------------- Failures

-- Counted before the proof is checked: a hundred attempts at the same time are still five. Five failures close for
-- fifteen minutes; fifteen minutes without any forget them.
CREATE FUNCTION app.take_attempt(wanted bytea, wanted_scope attempt_scope, OUT allowed boolean, OUT attempts_left integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  known public.lockouts;
BEGIN
  INSERT INTO public.lockouts (key_hash, scope, failures) VALUES (wanted, wanted_scope, 0) ON CONFLICT (key_hash) DO NOTHING;
  SELECT * INTO known FROM public.lockouts WHERE key_hash = wanted FOR UPDATE;
  IF known.locked_until > now() THEN
    allowed := false;
    attempts_left := 0;
    RETURN;
  END IF;
  IF known.locked_until IS NOT NULL OR known.last_failure_at < now() - interval '15 minutes' THEN
    known.failures := 0;
  END IF;
  UPDATE public.lockouts SET failures = known.failures + 1, last_failure_at = now(), locked_until = CASE WHEN known.failures + 1 >= 5 THEN now() + interval '15 minutes' END
  WHERE key_hash = wanted;
  allowed := true;
  attempts_left := 4 - known.failures;
END
$$;
CREATE FUNCTION app.clear_attempts(keys text[]) RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  DELETE FROM public.lockouts WHERE key_hash = ANY (app.digests(keys))
$$;

-- ---------------------------------------------------------------- What is done to the account of someone else

-- The Director, or a delegate acting on their behalf with one of these delegations.
CREATE FUNCTION app.acts_as_director(VARIADIC kinds delegation_kind[]) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT coalesce(app.staff_role() = 'DIRECTOR' OR (app.setting('acting_for')::public.delegation_kind = ANY (kinds) AND app.on_behalf_of() IS NOT NULL), false)
$$;
-- In the application, where nobody else can erase it.
CREATE FUNCTION app.tell_director(what notification_kind, by_whom uuid, about uuid, done support_action DEFAULT NULL) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  INSERT INTO public.notifications (user_id, kind, action, actor_id, target_id) SELECT app.director_id(), what, done, by_whom, about WHERE app.director_id() IS NOT NULL
$$;
-- A password of the team reset by a link: told to the Director, theirs included.
CREATE FUNCTION app.tell_reset() RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT app.tell_director('PASSWORD_RESET', app.proved_subject(), app.proved_subject()) WHERE app.actor_kind() = 'STAFF'
$$;
-- The technical delegation was given to someone: it ends when a delegate puts another one in their place. Told to the Director
-- each time, whether or not it was open: that role reads the journal and the technical settings.
CREATE FUNCTION app.end_technical_delegation() RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF app.staff_role() = 'DIRECTOR' THEN
    RETURN;
  END IF;
  UPDATE public.delegations SET withdrawn_at = now(), withdrawn_by = app.user_id() WHERE kind = 'TECHNICAL' AND withdrawn_at IS NULL;
  PERFORM app.tell_director((CASE WHEN FOUND THEN 'DELEGATION_ENDED' ELSE 'DEVELOPER_CHANGED' END)::public.notification_kind, app.user_id(), app.user_id());
END
$$;
-- Nothing open stays open: sessions, links, known browsers.
CREATE FUNCTION app.close_account(target uuid) RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  UPDATE public.user_sessions SET revoked_at = now() WHERE user_id = target AND revoked_at IS NULL;
  UPDATE public.auth_tokens SET used_at = now() WHERE user_id = target AND used_at IS NULL;
  DELETE FROM public.user_devices WHERE user_id = target;
$$;
-- With those they replace, always in the same order: two people who replace each other may leave at the same time.
CREATE FUNCTION app.take_with_substituted(target uuid) RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM 1 FROM public.users WHERE id = target OR substitute_id = target ORDER BY id FOR UPDATE;
END
$$;
-- The cases of someone who leaves or changes role have no officer any more: the manager gives them to someone else.
CREATE FUNCTION app.release_cases(target uuid) RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  released integer;
BEGIN
  INSERT INTO public.case_events (case_id, creditor_id, kind, title, actor_kind, actor_id, actor_label, on_behalf_of_id)
  SELECT c.id, c.creditor_id, 'CASE_RELEASED', 'Dossier sans gestionnaire', app.actor_kind(), app.actor_id(), app.actor_label(), app.on_behalf_of()
  FROM public.cases c WHERE c.officer_id = target;
  UPDATE public.cases SET officer_id = NULL, version = version + 1 WHERE officer_id = target;
  GET DIAGNOSTICS released = ROW_COUNT;
  UPDATE public.users SET substitute_id = NULL WHERE substitute_id = target;
  RETURN released;
END
$$;
-- Open from the first day of the application: the Director has nothing to set up. Those of a former Director end with
-- them, and the next one decides again.
CREATE FUNCTION app.open_delegations() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  UPDATE public.delegations SET withdrawn_at = now(), withdrawn_by = NEW.id WHERE withdrawn_at IS NULL AND granted_by <> NEW.id;
  IF NOT EXISTS (SELECT 1 FROM public.delegations) THEN
    INSERT INTO public.delegations (kind, granted_by) SELECT k.kind, NEW.id FROM unnest(enum_range(NULL::public.delegation_kind)) AS k (kind);
  END IF;
  RETURN NULL;
END
$$;

CREATE FUNCTION app.invite_member(wanted user_role, first text, last text, address citext, creditor uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  invited uuid;
BEGIN
  IF NOT app.acts_as_director('ADMINISTRATIVE') THEN
    PERFORM app.refuse('42501');
  END IF;
  INSERT INTO public.users (role, first_name, last_name, email, creditor_id, invited_by, invited_at)
  VALUES (wanted, first, last, address, creditor, app.user_id(), now()) RETURNING id INTO invited;
  IF wanted = 'DEVELOPER' THEN
    PERFORM app.end_technical_delegation();
  END IF;
  IF wanted <> 'CREDITOR' THEN
    INSERT INTO public.mailbox_requests (user_id, local, requested_by) VALUES (invited, split_part(lower(address::text), '@', 1), app.user_id());
  END IF;
  RETURN invited;
END
$$;
CREATE FUNCTION app.cancel_invitation(target uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NOT app.acts_as_director('ADMINISTRATIVE') THEN
    PERFORM app.refuse('42501');
  END IF;
  PERFORM 1 FROM public.users WHERE id = target AND status = 'INVITED' FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app.refuse('LG404');
  END IF;
  DELETE FROM public.auth_tokens WHERE user_id = target;
  DELETE FROM public.mailbox_requests WHERE user_id = target;
  DELETE FROM public.users WHERE id = target;
END
$$;
CREATE FUNCTION app.disable_member(target uuid, reason text, expected integer) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  account record;
BEGIN
  PERFORM app.take_with_substituted(target);
  SELECT id, role, status INTO account FROM public.users WHERE id = target FOR UPDATE;
  IF NOT FOUND OR account.status <> 'ACTIVE' THEN
    PERFORM app.refuse('LG404');
  END IF;
  IF NOT app.acts_as_director('ADMINISTRATIVE') OR account.role = 'DIRECTOR' OR account.id = app.user_id() THEN
    PERFORM app.refuse('42501');
  END IF;
  -- What was confirmed is what is done.
  IF app.release_cases(target) <> expected THEN
    PERFORM app.refuse('LG409');
  END IF;
  UPDATE public.users SET status = 'DISABLED', disabled_at = now(), disabled_by = app.user_id(), disabled_reason = reason WHERE id = target;
  PERFORM app.close_account(target);
END
$$;
-- Never with its former cases; invited again when it had never been activated.
CREATE FUNCTION app.enable_member(target uuid) RETURNS user_status
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  account record;
  opened public.user_status;
BEGIN
  IF NOT app.acts_as_director('ADMINISTRATIVE') THEN
    PERFORM app.refuse('42501');
  END IF;
  SELECT id, role, status, password_hash IS NOT NULL AS activated, anonymized_at INTO account FROM public.users WHERE id = target FOR UPDATE;
  IF NOT FOUND OR account.status <> 'DISABLED' OR account.anonymized_at IS NOT NULL THEN
    PERFORM app.refuse('LG404');
  END IF;
  opened := CASE WHEN account.activated THEN 'ACTIVE' ELSE 'INVITED' END;
  UPDATE public.users SET status = opened, disabled_at = NULL, disabled_by = NULL, disabled_reason = NULL,
    invited_at = CASE opened WHEN 'INVITED' THEN now() ELSE invited_at END WHERE id = target;
  IF account.role = 'DEVELOPER' THEN
    PERFORM app.end_technical_delegation();
  END IF;
  RETURN opened;
END
$$;
CREATE FUNCTION app.set_member_role(target uuid, wanted user_role) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  account record;
BEGIN
  PERFORM app.take_with_substituted(target);
  SELECT id, role, status INTO account FROM public.users WHERE id = target FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app.refuse('LG404');
  END IF;
  -- A creditor account never becomes a staff account, and nobody changes their own role.
  IF NOT app.acts_as_director('ADMINISTRATIVE') OR account.role IN ('DIRECTOR', 'CREDITOR') OR wanted = 'CREDITOR' OR account.id = app.user_id() OR account.status <> 'ACTIVE' THEN
    PERFORM app.refuse('42501');
  END IF;
  IF account.role = wanted THEN
    RETURN;
  END IF;
  PERFORM app.release_cases(target);
  UPDATE public.users SET role = wanted WHERE id = target;
  IF wanted = 'DEVELOPER' THEN
    PERFORM app.end_technical_delegation();
  END IF;
  PERFORM app.close_account(target);
END
$$;
CREATE FUNCTION app.set_extension(target uuid, wanted text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF app.staff_role() IS DISTINCT FROM 'DEVELOPER' OR NOT app.acts_as_director('TECHNICAL') THEN
    PERFORM app.refuse('42501');
  END IF;
  UPDATE public.users SET extension = wanted WHERE id = target AND role <> 'CREDITOR' AND status = 'ACTIVE';
  IF NOT FOUND THEN
    PERFORM app.refuse('LG404');
  END IF;
END
$$;
-- Support of an account. The Developer supports the team, the manager everyone but the Director, the Director everyone;
-- nobody supports themselves. Whatever someone else does is told to the Director, in the same transaction; what has no
-- object is refused, so that nothing that matters is buried under it.
CREATE FUNCTION app.support(target uuid, wanted support_action, keys text[]) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  account record;
  mine constant public.user_role := app.staff_role();
  touched boolean := true;
BEGIN
  -- Nothing is closed for good here: two people who support each other do not wait for each other.
  SELECT id, role, status INTO account FROM public.users WHERE id = target FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    PERFORM app.refuse('LG404');
  END IF;
  IF NOT app.acts_as_director('TECHNICAL', 'ADMINISTRATIVE') OR account.status <> 'ACTIVE' OR account.id = app.user_id()
    OR (mine = 'DEVELOPER' AND account.role = 'CREDITOR')
    OR (mine = 'COLLECTION_MANAGER' AND account.role = 'DIRECTOR')
    -- Nobody imposes it on the Director.
    OR (wanted = 'SECOND_FACTOR_REQUIRED' AND account.role = 'DIRECTOR')
    -- That of the Developer: the Director alone. The others: the Developer; those of the creditors, who have none: the manager.
    OR (wanted = 'SECOND_FACTOR_RESET' AND mine <> 'DIRECTOR' AND (account.role = 'DEVELOPER' OR (mine = 'COLLECTION_MANAGER' AND account.role <> 'CREDITOR')))
  THEN
    PERFORM app.refuse('42501');
  END IF;
  CASE wanted
    WHEN 'SECOND_FACTOR_REQUIRED' THEN
      UPDATE public.users SET two_factor_required = true WHERE id = target AND NOT two_factor_required;
      touched := FOUND;
    WHEN 'SECOND_FACTOR_RESET' THEN
      DELETE FROM public.second_factors WHERE user_id = target;
      touched := FOUND;
      DELETE FROM public.backup_codes WHERE user_id = target;
      UPDATE public.user_sessions SET revoked_at = now() WHERE user_id = target AND revoked_at IS NULL;
      -- What was being set up goes with it: challenges of a key, step of an invitation.
      UPDATE public.auth_tokens SET used_at = now() WHERE user_id = target AND purpose <> 'RESET' AND used_at IS NULL;
    WHEN 'ACCOUNT_UNLOCKED' THEN
      touched := EXISTS (SELECT 1 FROM public.lockouts WHERE key_hash = ANY (app.digests(keys)) AND locked_until > now());
      DELETE FROM public.lockouts WHERE key_hash = ANY (app.digests(keys));
    ELSE
      NULL;
  END CASE;
  IF NOT touched THEN
    PERFORM app.refuse('LG409');
  END IF;
  IF mine <> 'DIRECTOR' THEN
    PERFORM app.tell_director('SUPPORT_ACTION', app.user_id(), target, wanted);
  END IF;
END
$$;
-- Second factor, open sessions and lock of each account: what the screen of the team shows, never to anyone else.
CREATE FUNCTION app.account_states() RETURNS TABLE (user_id uuid, second_factor boolean, sessions integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT u.id,
    EXISTS (SELECT 1 FROM public.second_factors f WHERE f.user_id = u.id AND f.confirmed_at IS NOT NULL),
    (SELECT count(*)::integer FROM public.user_sessions s
     WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > now() AND s.last_seen_at > now() - interval '30 minutes'
       AND (NOT s.second_factor_needed OR s.second_factor_at IS NOT NULL))
  FROM public.users u WHERE app.staff_role() IN ('DIRECTOR', 'COLLECTION_MANAGER', 'DEVELOPER') AND (u.role <> 'CREDITOR' OR app.staff_role() <> 'DEVELOPER')
$$;
CREATE FUNCTION app.locked(keys text[]) RETURNS SETOF text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT encode(key_hash, 'hex') FROM public.lockouts WHERE key_hash = ANY (app.digests(keys)) AND locked_until > now() AND app.staff_role() IN ('DIRECTOR', 'COLLECTION_MANAGER', 'DEVELOPER')
$$;
CREATE FUNCTION app.set_delegation(wanted delegation_kind, active boolean) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  changed uuid;
BEGIN
  -- The Director alone: a delegate can neither keep nor take one back.
  IF app.staff_role() IS DISTINCT FROM 'DIRECTOR' THEN
    PERFORM app.refuse('42501');
  END IF;
  IF active THEN
    INSERT INTO public.delegations (kind, granted_by) VALUES (wanted, app.user_id())
    ON CONFLICT (kind) WHERE withdrawn_at IS NULL DO NOTHING RETURNING id INTO changed;
  ELSE
    UPDATE public.delegations SET withdrawn_at = now(), withdrawn_by = app.user_id() WHERE kind = wanted AND withdrawn_at IS NULL RETURNING id INTO changed;
  END IF;
  RETURN changed;
END
$$;
-- The Developer answers. Their own tickets, and all of them while nobody holds that role, go to the Director.
CREATE FUNCTION app.ticket_reader(ticket uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT u.id FROM public.users u, public.support_tickets t
  WHERE t.id = ticket AND u.status = 'ACTIVE' AND u.role IN ('DEVELOPER', 'DIRECTOR') AND u.id <> t.user_id ORDER BY u.role = 'DEVELOPER' DESC LIMIT 1
$$;
CREATE FUNCTION app.open_ticket(wanted_subject text, wanted_message text, OUT ticket uuid, OUT ticket_number text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  for_year constant integer := extract(year FROM now() AT TIME ZONE 'Europe/Paris');
  drawn integer;
BEGIN
  IF app.actor_kind() <> 'STAFF' THEN
    PERFORM app.refuse('42501');
  END IF;
  INSERT INTO public.number_sequences AS s (kind, year, last_value) VALUES ('TICKET', for_year, 1)
  ON CONFLICT (kind, year) DO UPDATE SET last_value = s.last_value + 1 RETURNING last_value INTO drawn;
  ticket_number := for_year || '-' || lpad(drawn::text, greatest(4, length(drawn::text)), '0');
  ticket := app.uuid_v7();
  INSERT INTO public.support_tickets (id, number, user_id, subject, message) VALUES (ticket, ticket_number, app.user_id(), wanted_subject, wanted_message);
  INSERT INTO public.notifications (user_id, kind, ticket_id, actor_id)
  SELECT app.ticket_reader(ticket), 'SUPPORT_TICKET', ticket, app.user_id() WHERE app.ticket_reader(ticket) IS NOT NULL;
END
$$;
-- Person in charge shown to a creditor: the manager, until each creditor has its own.
CREATE FUNCTION app.portal_officer() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT first_name || ' ' || last_name FROM public.users WHERE role = 'COLLECTION_MANAGER' AND status = 'ACTIVE' AND app.partner_creditor() IS NOT NULL
$$;
-- First account of the application, from the server only.
CREATE FUNCTION app.create_director(first text, last text, address citext) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  created uuid;
BEGIN
  IF app.actor_kind() <> 'SYSTEM' OR EXISTS (SELECT 1 FROM public.users WHERE role = 'DIRECTOR' AND status <> 'DISABLED') THEN
    PERFORM app.refuse('LG409');
  END IF;
  INSERT INTO public.users (role, first_name, last_name, email, invited_at) VALUES ('DIRECTOR', first, last, address, now()) RETURNING id INTO created;
  RETURN created;
END
$$;

-- ---------------------------------------------------------------- Retention

-- Sessions and links: 48 hours after their end. Browsers: at their end. Failures: one year.
CREATE FUNCTION app.purge_sign_ins() RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  removed integer := 0;
  batch integer;
BEGIN
  -- Never waiting for a line that someone else holds: it goes at the next purge.
  DELETE FROM public.auth_tokens WHERE id IN (SELECT t.id FROM public.auth_tokens t WHERE least(t.used_at, t.expires_at) < now() - interval '48 hours' FOR UPDATE SKIP LOCKED);
  GET DIAGNOSTICS batch = ROW_COUNT;
  removed := removed + batch;
  DELETE FROM public.user_sessions WHERE id IN (
    SELECT s.id FROM public.user_sessions s WHERE least(s.revoked_at, s.expires_at, s.last_seen_at + interval '30 minutes') < now() - interval '48 hours'
      AND NOT EXISTS (SELECT 1 FROM public.auth_tokens t WHERE t.session_id = s.id) FOR UPDATE SKIP LOCKED);
  GET DIAGNOSTICS batch = ROW_COUNT;
  removed := removed + batch;
  DELETE FROM public.user_devices WHERE expires_at < now();
  GET DIAGNOSTICS batch = ROW_COUNT;
  removed := removed + batch;
  DELETE FROM public.lockouts WHERE last_failure_at < now() - interval '1 year';
  GET DIAGNOSTICS batch = ROW_COUNT;
  RETURN removed + batch;
END
$$;
-- An account disabled for two years is nobody any more. Its line stays: the history refers to it. Nothing refers to an
-- invitation that nobody has accepted in a year.
CREATE FUNCTION app.anonymize_accounts() RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  old uuid[];
  forgotten uuid[];
BEGIN
  -- Held until the end, so that none of them is opened again meanwhile; one that someone holds waits for the next purge.
  SELECT coalesce(array_agg(held.id), '{}') INTO forgotten FROM (
    SELECT u.id FROM public.users u WHERE u.status = 'INVITED' AND u.password_hash IS NULL AND u.invited_at < now() - interval '1 year' ORDER BY u.id FOR UPDATE SKIP LOCKED) held;
  DELETE FROM public.auth_tokens WHERE user_id = ANY (forgotten);
  DELETE FROM public.mailbox_requests WHERE user_id = ANY (forgotten);
  DELETE FROM public.users WHERE id = ANY (forgotten);
  SELECT coalesce(array_agg(held.id), '{}') INTO old FROM (
    SELECT u.id FROM public.users u WHERE u.status = 'DISABLED' AND u.anonymized_at IS NULL AND u.disabled_at < now() - interval '2 years' ORDER BY u.id FOR UPDATE SKIP LOCKED) held;
  DELETE FROM public.second_factors WHERE user_id = ANY (old);
  DELETE FROM public.backup_codes WHERE user_id = ANY (old);
  DELETE FROM public.auth_tokens WHERE user_id = ANY (old);
  DELETE FROM public.user_sessions WHERE user_id = ANY (old);
  DELETE FROM public.user_devices WHERE user_id = ANY (old);
  DELETE FROM public.notification_preferences WHERE user_id = ANY (old);
  DELETE FROM public.notifications WHERE user_id = ANY (old);
  DELETE FROM public.mailbox_requests WHERE user_id = ANY (old);
  UPDATE public.users SET first_name = 'Compte', last_name = 'anonymisé', email = id || '@anonyme.invalid', extension = NULL, password_hash = NULL, disabled_reason = NULL, substitute_id = NULL, anonymized_at = now()
  WHERE id = ANY (old);
  RETURN cardinality(old) + cardinality(forgotten);
END
$$;

-- ---------------------------------------------------------------- Rights on the functions

GRANT EXECUTE ON FUNCTION app.account_of(citext), app.account_of_link(token_purpose, text[]), app.inviter_name(), app.resume_session(account_portal, text[], boolean),
  app.take_attempt(bytea, attempt_scope), app.clear_attempts(text[]), app.tell_reset() TO legarec_auth;
GRANT EXECUTE ON FUNCTION app.acts_as_director(delegation_kind[]), app.invite_member(user_role, text, text, citext, uuid), app.cancel_invitation(uuid),
  app.disable_member(uuid, text, integer), app.enable_member(uuid), app.set_member_role(uuid, user_role), app.set_extension(uuid, text),
  app.support(uuid, support_action, text[]), app.account_states(), app.locked(text[]), app.set_delegation(delegation_kind, boolean), app.open_ticket(text, text) TO legarec_staff;
GRANT EXECUTE ON FUNCTION app.portal_officer() TO legarec_partner;
GRANT EXECUTE ON FUNCTION app.create_director(text, text, citext), app.ticket_reader(uuid) TO legarec_worker;
GRANT EXECUTE ON FUNCTION app.purge_sign_ins(), app.anonymize_accounts() TO legarec_retention;

-- The owner of the tables creates the trigger.
GRANT EXECUTE ON FUNCTION app.open_delegations() TO legarec_owner;
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM legarec_definer;

CREATE TRIGGER users_director_insert AFTER INSERT ON users FOR EACH ROW WHEN (NEW.role = 'DIRECTOR' AND NEW.status = 'ACTIVE') EXECUTE FUNCTION app.open_delegations();
CREATE TRIGGER users_director_update AFTER UPDATE OF role, status ON users FOR EACH ROW
  WHEN (NEW.role = 'DIRECTOR' AND NEW.status = 'ACTIVE' AND (OLD.role <> 'DIRECTOR' OR OLD.status <> 'ACTIVE')) EXECUTE FUNCTION app.open_delegations();

-- ---------------------------------------------------------------- Policies and rights on the tables

CALL app.secure('user_devices');
CALL app.secure('user_sessions');
CALL app.secure('second_factors');
CALL app.secure('backup_codes');
CALL app.secure('auth_tokens');
CALL app.secure('lockouts');
CALL app.secure('notification_preferences');
CALL app.secure('notifications');
CALL app.secure('support_tickets');
CALL app.secure('mailbox_requests');

DO $$
DECLARE
  name text;
BEGIN
  -- What the definer functions may touch (the columns are limited above).
  FOREACH name IN ARRAY ARRAY['user_devices', 'user_sessions', 'second_factors', 'backup_codes', 'auth_tokens', 'lockouts', 'notification_preferences', 'notifications', 'support_tickets', 'mailbox_requests'] LOOP
    EXECUTE format('CREATE POLICY definer_all ON %I TO legarec_definer USING (true) WITH CHECK (true)', name);
  END LOOP;
  -- The sign-in: one account at a time, the one it has found; written once that account is proved.
  FOREACH name IN ARRAY ARRAY['user_devices', 'user_sessions', 'second_factors', 'backup_codes', 'auth_tokens'] LOOP
    EXECUTE format('CREATE POLICY subject_read ON %I FOR SELECT TO legarec_auth USING (user_id = (SELECT app.subject()))', name);
    EXECUTE format('CREATE POLICY subject_add ON %I FOR INSERT TO legarec_auth WITH CHECK (user_id = (SELECT app.proved_subject()))', name);
    EXECUTE format('CREATE POLICY subject_change ON %I FOR UPDATE TO legarec_auth USING (user_id = (SELECT app.proved_subject())) WITH CHECK (user_id = (SELECT app.proved_subject()))', name);
    EXECUTE format('CREATE POLICY subject_remove ON %I FOR DELETE TO legarec_auth USING (user_id = (SELECT app.proved_subject()))', name);
  END LOOP;
END
$$;
CREATE POLICY definer_write ON users FOR INSERT TO legarec_definer WITH CHECK (true);
CREATE POLICY definer_change ON users FOR UPDATE TO legarec_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_remove ON users FOR DELETE TO legarec_definer USING (status = 'INVITED');
CREATE POLICY definer_write ON delegations FOR INSERT TO legarec_definer WITH CHECK (true);
CREATE POLICY definer_change ON delegations FOR UPDATE TO legarec_definer USING (true) WITH CHECK (true);

-- Never a disabled account, and only towards an active one.
CREATE POLICY subject_read ON users FOR SELECT TO legarec_auth USING (id = (SELECT app.subject()));
CREATE POLICY subject_change ON users FOR UPDATE TO legarec_auth USING (id = (SELECT app.proved_subject()) AND status <> 'DISABLED') WITH CHECK (id = (SELECT app.proved_subject()) AND status = 'ACTIVE');
GRANT SELECT (id, role, status, first_name, last_name, email, creditor_id, password_hash, two_factor_required, last_seen_at), UPDATE (status, password_hash, password_changed_at, last_seen_at) ON users TO legarec_auth;
GRANT SELECT (id, user_id, portal, device_label, mobile, ip, second_factor_needed, second_factor_at, persistent, created_at, proved_at, last_seen_at, expires_at, revoked_at),
  INSERT (user_id, portal, token_hash, device_label, mobile, ip, second_factor_needed, second_factor_at, persistent, expires_at),
  UPDATE (token_hash, second_factor_at, proved_at, last_seen_at, expires_at, revoked_at) ON user_sessions TO legarec_auth;
GRANT SELECT (id, user_id, token_hash, expires_at), INSERT (user_id, token_hash, label, expires_at), UPDATE (label, last_seen_at, expires_at) ON user_devices TO legarec_auth;
GRANT SELECT (id, user_id, kind, secret_cipher, last_step, credential_id, public_key, sign_count, transports, created_at, confirmed_at, last_used_at),
  INSERT (id, user_id, kind, secret_cipher, credential_id, public_key, sign_count, transports, confirmed_at), UPDATE (secret_cipher, last_step, sign_count, confirmed_at, last_used_at), DELETE ON second_factors TO legarec_auth;
GRANT SELECT (id, user_id, code_hash, used_at), INSERT (user_id, code_hash), UPDATE (used_at), DELETE ON backup_codes TO legarec_auth;
GRANT SELECT (id, user_id, purpose, session_id, token_hash, created_at, expires_at, opened_at, used_at), INSERT (purpose, user_id, session_id, token_hash, expires_at), UPDATE (expires_at, opened_at, used_at) ON auth_tokens TO legarec_auth;

-- The worker draws the links when it sends them: they are written nowhere else.
CREATE POLICY worker_links ON auth_tokens TO legarec_worker USING (purpose <> 'WEBAUTHN') WITH CHECK (purpose <> 'WEBAUTHN');
GRANT SELECT (id, user_id, purpose, used_at), INSERT (purpose, user_id, token_hash, expires_at), UPDATE (used_at) ON auth_tokens TO legarec_worker;
CREATE POLICY worker_read ON user_sessions FOR SELECT TO legarec_worker USING (true);
GRANT SELECT (id, user_id, device_label, ip, created_at) ON user_sessions TO legarec_worker;
CREATE POLICY worker_read ON second_factors FOR SELECT TO legarec_worker USING (true);
GRANT SELECT (id, user_id, kind, confirmed_at) ON second_factors TO legarec_worker;
CREATE POLICY worker_read ON support_tickets FOR SELECT TO legarec_worker USING (true);
GRANT SELECT (id, number, user_id, subject, message, created_at) ON support_tickets TO legarec_worker;
CREATE POLICY worker_read ON delegations FOR SELECT TO legarec_worker USING (true);
GRANT SELECT (id, kind, granted_by, granted_at, withdrawn_by, withdrawn_at) ON delegations TO legarec_worker;
GRANT SELECT (invited_by, two_factor_required) ON users TO legarec_worker;

-- One's own account: the preferences, never the role, the address nor the credentials.
CREATE POLICY self_change ON users FOR UPDATE TO legarec_staff USING (id = (SELECT app.user_id()) AND (SELECT app.staff_role()) IS NOT NULL) WITH CHECK (id = (SELECT app.user_id()));
GRANT SELECT (password_changed_at, two_factor_required, theme, density, low_vision, daily_summary, quiet_hours, substitute_id, absent_from, absent_until, auto_reply, invited_at, anonymized_at),
  UPDATE (first_name, last_name, theme, density, low_vision, daily_summary, quiet_hours, substitute_id, absent_from, absent_until, auto_reply) ON users TO legarec_staff;
CREATE POLICY self_all ON notification_preferences TO legarec_staff USING (user_id = (SELECT app.user_id()) AND (SELECT app.staff_role()) IS NOT NULL) WITH CHECK (user_id = (SELECT app.user_id()));
GRANT SELECT (user_id, kind, in_app, email), INSERT (user_id, kind, in_app, email), UPDATE (in_app, email) ON notification_preferences TO legarec_staff;
CREATE POLICY self_read ON notifications FOR SELECT TO legarec_staff USING (user_id = (SELECT app.user_id()) AND (SELECT app.staff_role()) IS NOT NULL);
CREATE POLICY self_change ON notifications FOR UPDATE TO legarec_staff USING (user_id = (SELECT app.user_id()) AND (SELECT app.staff_role()) IS NOT NULL) WITH CHECK (user_id = (SELECT app.user_id()));
GRANT SELECT (id, user_id, kind, action, actor_id, target_id, ticket_id, created_at, read_at), UPDATE (read_at) ON notifications TO legarec_staff;
CREATE POLICY staff_read ON support_tickets FOR SELECT TO legarec_staff USING (user_id = (SELECT app.user_id()) OR (SELECT app.staff_role()) IN ('DIRECTOR', 'DEVELOPER'));
GRANT SELECT (id, number, user_id, subject, message, status, created_at) ON support_tickets TO legarec_staff;
CREATE POLICY staff_read ON mailbox_requests FOR SELECT TO legarec_staff USING ((SELECT app.staff_role()) IN ('DIRECTOR', 'DEVELOPER'));
GRANT SELECT (id, user_id, local, requested_by, status, decided_by, created_at, decided_at) ON mailbox_requests TO legarec_staff;

CREATE POLICY retention_purge ON notifications TO legarec_retention USING (true);
GRANT SELECT (created_at), DELETE ON notifications TO legarec_retention;
CREATE POLICY retention_purge ON support_tickets TO legarec_retention USING (true);
GRANT SELECT (created_at), DELETE ON support_tickets TO legarec_retention;
