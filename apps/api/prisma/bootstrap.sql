-- Roles of the API. Run once by a superuser (or the entry point of the container); safe to run again.
-- Passwords are set apart, never in this file. Every privilege is granted by the migrations.
DO $$
DECLARE
  name text;
BEGIN
  -- One role per kind of actor: nobody signs in with them, the API switches to one inside each transaction.
  FOREACH name IN ARRAY ARRAY[
    'legarec_auth', 'legarec_staff', 'legarec_partner', 'legarec_debtor', 'legarec_hook', 'legarec_public', 'legarec_service', 'legarec_worker', 'legarec_retention'
  ] LOOP
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = name) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN NOINHERIT NOBYPASSRLS', name);
    END IF;
  END LOOP;
  -- Owner of the few functions that need more than the caller: no one signs in with it.
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'legarec_definer') THEN
    CREATE ROLE legarec_definer NOLOGIN NOINHERIT NOBYPASSRLS;
  END IF;
  -- Owner of the two functions that erase what the retention or a debtor asks to forget: no one signs in with it, and only
  -- legarec_definer calls them.
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'legarec_forgetter') THEN
    CREATE ROLE legarec_forgetter NOLOGIN NOINHERIT NOBYPASSRLS;
  END IF;
  -- legarec_owner runs the migrations; legarec_app is the HTTP API; legarec_jobs is the worker.
  FOREACH name IN ARRAY ARRAY['legarec_owner', 'legarec_app', 'legarec_jobs'] LOOP
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = name) THEN
      EXECUTE format('CREATE ROLE %I LOGIN NOINHERIT NOBYPASSRLS NOCREATEROLE NOCREATEDB', name);
    END IF;
  END LOOP;
END
$$;

-- No inherited right: without SET LOCAL ROLE, every statement ends in "permission denied".
GRANT legarec_auth, legarec_staff, legarec_partner, legarec_debtor, legarec_hook, legarec_public, legarec_service TO legarec_app WITH INHERIT FALSE, SET TRUE;
-- A task runs with the rights of its author (collaborator, creditor, debtor, service account); the others as the worker.
GRANT legarec_worker, legarec_retention, legarec_staff, legarec_partner, legarec_debtor, legarec_service TO legarec_jobs WITH INHERIT FALSE, SET TRUE;

-- The migrations take back the rights of PUBLIC on the database, which only its owner can do. Run in that database: the
-- official image creates it for its superuser.
DO $$
BEGIN
  IF current_database() <> 'postgres' THEN
    EXECUTE format('ALTER DATABASE %I OWNER TO legarec_owner', current_database());
  END IF;
END
$$;

-- Nothing runs, waits or stays open for ever.
ALTER ROLE legarec_app SET statement_timeout = '15s';
ALTER ROLE legarec_app SET lock_timeout = '5s';
ALTER ROLE legarec_app SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE legarec_jobs SET statement_timeout = '60s';
ALTER ROLE legarec_jobs SET lock_timeout = '10s';
ALTER ROLE legarec_jobs SET idle_in_transaction_session_timeout = '120s';
-- The migrations hand the definer functions over to their owner.
GRANT legarec_definer, legarec_forgetter TO legarec_owner WITH INHERIT FALSE, SET TRUE;
