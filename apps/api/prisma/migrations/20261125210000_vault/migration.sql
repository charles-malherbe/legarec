-- Vault: keys of the services, and internal keys drawn by the API. A value is encrypted by the API before it comes here;
-- nobody of the team reads it, and it is erased when it is revoked.

CREATE TYPE secret_kind AS ENUM ('SERVICE', 'INTERNAL');
CREATE TYPE secret_status AS ENUM ('VALID', 'REVOKE_PENDING', 'REVOKED');
CREATE TYPE secret_rotation AS ENUM ('DAYS_30', 'DAYS_90', 'MANUAL');

CREATE TABLE vault_secrets (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  name secret_name NOT NULL,
  kind secret_kind NOT NULL GENERATED ALWAYS AS (
    CASE WHEN name IN ('MAILBOX_SECRETS_KEY', 'ACCESS_CODE_KEY', 'LOOKUP_KEY') THEN 'INTERNAL'::secret_kind ELSE 'SERVICE'::secret_kind END) STORED,
  value_cipher bytea,
  status secret_status NOT NULL DEFAULT 'VALID',
  rotation secret_rotation NOT NULL DEFAULT 'MANUAL',
  rotated_at timestamptz(3) NOT NULL DEFAULT now(),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  requested_by uuid REFERENCES users (id),
  decided_by uuid REFERENCES users (id),
  last_used_at timestamptz(3),
  CONSTRAINT vault_secrets_revoked CHECK ((status = 'REVOKED') = (value_cipher IS NULL)),
  CONSTRAINT vault_secrets_internal CHECK (kind = 'SERVICE' OR status = 'VALID')
);
-- A revoked one never comes back: it is replaced.
CREATE UNIQUE INDEX vault_secrets_live ON vault_secrets (name) WHERE status <> 'REVOKED';

GRANT CREATE ON SCHEMA app TO legarec_definer;
GRANT SELECT (id, name, kind, status), INSERT (id, name, value_cipher, rotation), UPDATE (value_cipher, status, rotated_at, requested_by, decided_by) ON vault_secrets TO legarec_definer;
SET LOCAL ROLE legarec_definer;

CREATE FUNCTION app.save_secret(wanted_id uuid, wanted secret_name, cipher bytea, every secret_rotation) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NOT app.acts_as_director('TECHNICAL') THEN
    PERFORM app.refuse('42501');
  END IF;
  INSERT INTO public.vault_secrets (id, name, value_cipher, rotation) VALUES (wanted_id, wanted, cipher, every);
  -- Internal keys are drawn by the API, never typed.
  IF (SELECT kind FROM public.vault_secrets WHERE id = wanted_id) <> 'SERVICE' THEN
    PERFORM app.refuse('42501');
  END IF;
END
$$;
CREATE FUNCTION app.renew_secret(target uuid, cipher bytea) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NOT app.acts_as_director('TECHNICAL') THEN
    PERFORM app.refuse('42501');
  END IF;
  UPDATE public.vault_secrets SET value_cipher = cipher, rotated_at = now() WHERE id = target AND kind = 'SERVICE' AND status = 'VALID';
  IF NOT FOUND THEN
    PERFORM app.refuse('LG409');
  END IF;
END
$$;
-- The Developer asks for it, the Director decides.
CREATE FUNCTION app.revoke_secret(target uuid) RETURNS secret_status
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  director constant boolean := app.staff_role() = 'DIRECTOR';
BEGIN
  IF NOT app.acts_as_director('TECHNICAL') THEN
    PERFORM app.refuse('42501');
  END IF;
  IF director THEN
    UPDATE public.vault_secrets SET status = 'REVOKED', value_cipher = NULL, decided_by = app.user_id() WHERE id = target AND kind = 'SERVICE' AND status <> 'REVOKED';
  ELSE
    UPDATE public.vault_secrets SET status = 'REVOKE_PENDING', requested_by = app.user_id() WHERE id = target AND kind = 'SERVICE' AND status = 'VALID';
  END IF;
  IF NOT FOUND THEN
    PERFORM app.refuse('LG409');
  END IF;
  RETURN CASE WHEN director THEN 'REVOKED' ELSE 'REVOKE_PENDING' END;
END
$$;
CREATE FUNCTION app.keep_secret(target uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF app.staff_role() IS DISTINCT FROM 'DIRECTOR' THEN
    PERFORM app.refuse('42501');
  END IF;
  UPDATE public.vault_secrets SET status = 'VALID', decided_by = app.user_id() WHERE id = target AND status = 'REVOKE_PENDING';
  IF NOT FOUND THEN
    PERFORM app.refuse('LG409');
  END IF;
END
$$;
GRANT EXECUTE ON FUNCTION app.save_secret(uuid, secret_name, bytea, secret_rotation), app.renew_secret(uuid, bytea), app.revoke_secret(uuid), app.keep_secret(uuid) TO legarec_staff;
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM legarec_definer;

CALL app.secure('vault_secrets');
CREATE POLICY definer_all ON vault_secrets TO legarec_definer USING (true) WITH CHECK (true);
-- Everything but the value.
CREATE POLICY staff_read ON vault_secrets FOR SELECT TO legarec_staff USING ((SELECT app.staff_role()) IN ('DIRECTOR', 'DEVELOPER'));
GRANT SELECT (id, name, kind, status, rotation, rotated_at, created_at, requested_by, decided_by, last_used_at) ON vault_secrets TO legarec_staff;
