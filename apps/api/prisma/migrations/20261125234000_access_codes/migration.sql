-- Access codes of the debtors, and the internal keys that encrypt them.

-- One code per debtor, for all their cases. Encrypted by the API, bound to its debtor.
CREATE TABLE debtor_access_codes (
  debtor_id uuid PRIMARY KEY REFERENCES debtors (id),
  code_cipher bytea NOT NULL,
  version integer NOT NULL DEFAULT 1,
  generated_by uuid REFERENCES users (id),
  generated_at timestamptz(3) NOT NULL DEFAULT now()
);
-- A former code never comes back: a letter already sent must not open anything again. A keyed digest, never the code.
CREATE TABLE debtor_retired_codes (
  debtor_id uuid NOT NULL REFERENCES debtors (id),
  code_hmac bytea NOT NULL,
  retired_at timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (debtor_id, code_hmac)
);

GRANT CREATE ON SCHEMA app TO legarec_definer;
GRANT SELECT (value_cipher, rotated_at) ON vault_secrets TO legarec_definer;
GRANT SELECT (closed_on) ON cases TO legarec_definer;
GRANT SELECT (debtor_id, code_cipher, version), INSERT (debtor_id, code_cipher, generated_by), UPDATE (code_cipher, version, generated_by, generated_at) ON debtor_access_codes TO legarec_definer;
GRANT SELECT (debtor_id, code_hmac), INSERT (debtor_id, code_hmac) ON debtor_retired_codes TO legarec_definer;
SET LOCAL ROLE legarec_definer;

-- Encrypted by the master key, which is not in the database: it opens nothing by itself.
CREATE FUNCTION app.internal_key(wanted secret_name) RETURNS TABLE (id uuid, value_cipher bytea, rotated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT s.id, s.value_cipher, s.rotated_at FROM public.vault_secrets s WHERE s.name = wanted AND s.kind = 'INTERNAL' AND app.actor_kind() IN ('STAFF', 'SYSTEM')
$$;
-- The first one that is drawn is the one.
CREATE FUNCTION app.first_internal_key(wanted_id uuid, wanted secret_name, cipher bytea) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF wanted NOT IN ('MAILBOX_SECRETS_KEY', 'ACCESS_CODE_KEY', 'LOOKUP_KEY') OR app.actor_kind() NOT IN ('STAFF', 'SYSTEM') OR (wanted = 'MAILBOX_SECRETS_KEY' AND app.actor_kind() = 'STAFF' AND NOT app.acts_as_director('TECHNICAL')) THEN
    PERFORM app.refuse('42501');
  END IF;
  INSERT INTO public.vault_secrets (id, name, value_cipher, rotation) VALUES (wanted_id, wanted, cipher, 'MANUAL')
  ON CONFLICT (name) WHERE status <> 'REVOKED' DO NOTHING;
END
$$;
CREATE FUNCTION app.renew_internal_key(target uuid, cipher bytea, seen bytea) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NOT app.acts_as_director('TECHNICAL') THEN
    PERFORM app.refuse('42501');
  END IF;
  UPDATE public.vault_secrets SET value_cipher = cipher, rotated_at = now() WHERE id = target AND kind = 'INTERNAL' AND value_cipher = seen;
  IF NOT FOUND THEN
    PERFORM app.refuse('LG409');
  END IF;
END
$$;

-- Of the debtor of a case, for whoever acts on that case while it is open: the code opens all the cases of the debtor.
CREATE FUNCTION app.access_code(target uuid) RETURNS TABLE (debtor_id uuid, code_cipher bytea, version integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT a.debtor_id, a.code_cipher, a.version FROM public.cases c JOIN public.debtor_access_codes a ON a.debtor_id = c.debtor_id
  WHERE c.id = target AND c.closed_on IS NULL AND app.can_act_on_case(c.officer_id)
$$;
-- Two cases of a debtor opened at the same time: one code.
CREATE FUNCTION app.first_access_code(target uuid, cipher bytea) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  debtor uuid;
BEGIN
  SELECT c.debtor_id INTO debtor FROM public.cases c WHERE c.id = target AND c.closed_on IS NULL AND app.can_act_on_case(c.officer_id);
  IF debtor IS NULL THEN
    PERFORM app.refuse('42501');
  END IF;
  INSERT INTO public.debtor_access_codes (debtor_id, code_cipher, generated_by) VALUES (debtor, cipher, app.user_id()) ON CONFLICT DO NOTHING;
END
$$;
-- `digests` are those of the new code under every key still known. False: that code has been used, another one is drawn.
CREATE FUNCTION app.renew_access_code(target uuid, seen integer, retired bytea, cipher bytea, digests bytea[]) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  debtor uuid;
BEGIN
  SELECT c.debtor_id INTO debtor FROM public.cases c WHERE c.id = target AND c.closed_on IS NULL AND app.can_act_on_case(c.officer_id);
  IF debtor IS NULL THEN
    PERFORM app.refuse('42501');
  END IF;
  IF EXISTS (SELECT 1 FROM public.debtor_retired_codes r WHERE r.debtor_id = debtor AND r.code_hmac = ANY (digests)) THEN
    RETURN false;
  END IF;
  UPDATE public.debtor_access_codes a SET code_cipher = cipher, version = a.version + 1, generated_by = app.user_id(), generated_at = now() WHERE a.debtor_id = debtor AND a.version = seen;
  IF NOT FOUND THEN
    PERFORM app.refuse('LG409');
  END IF;
  -- Null when no key opened the former one: it opens nothing either.
  IF retired IS NOT NULL THEN
    INSERT INTO public.debtor_retired_codes (debtor_id, code_hmac) VALUES (debtor, retired) ON CONFLICT DO NOTHING;
  END IF;
  -- The code is common to all the cases: whoever follows another one learns that their letters no longer open anything, not who did it.
  INSERT INTO public.case_events (case_id, creditor_id, kind, title, detail, tone, actor_kind, actor_id, actor_label, on_behalf_of_id)
  SELECT c.id, c.creditor_id, 'ACCESS_CODE_RENEWED', 'Code d’accès régénéré', 'Ancien code inutilisable', 'warning',
    CASE WHEN c.id = target THEN app.actor_kind() ELSE 'SYSTEM' END, CASE WHEN c.id = target THEN app.actor_id() END,
    CASE WHEN c.id = target THEN app.actor_label() ELSE 'Legarec' END, CASE WHEN c.id = target THEN app.on_behalf_of() END
  FROM public.cases c WHERE c.debtor_id = debtor AND c.closed_on IS NULL;
  RETURN true;
END
$$;
GRANT EXECUTE ON FUNCTION app.internal_key(secret_name), app.first_internal_key(uuid, secret_name, bytea) TO legarec_staff, legarec_worker;
GRANT EXECUTE ON FUNCTION app.renew_internal_key(uuid, bytea, bytea), app.access_code(uuid), app.first_access_code(uuid, bytea),
  app.renew_access_code(uuid, integer, bytea, bytea, bytea[]) TO legarec_staff;
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM legarec_definer;

CALL app.secure('debtor_access_codes');
CALL app.secure('debtor_retired_codes');
CREATE POLICY definer_all ON debtor_access_codes TO legarec_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON debtor_retired_codes TO legarec_definer USING (true) WITH CHECK (true);
-- Encrypts them again after a renewal of the key, and prints them.
CREATE POLICY worker_all ON debtor_access_codes TO legarec_worker USING (true) WITH CHECK (true);
GRANT SELECT (debtor_id, code_cipher), UPDATE (code_cipher) ON debtor_access_codes TO legarec_worker;
