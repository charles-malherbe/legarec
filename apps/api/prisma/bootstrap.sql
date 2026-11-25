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
-- A task born from a collaborator runs with the rights of that collaborator; the others run as the worker.
GRANT legarec_worker, legarec_retention, legarec_staff TO legarec_jobs WITH INHERIT FALSE, SET TRUE;
-- The migrations hand the definer functions over to their owner.
GRANT legarec_definer TO legarec_owner WITH INHERIT FALSE, SET TRUE;
