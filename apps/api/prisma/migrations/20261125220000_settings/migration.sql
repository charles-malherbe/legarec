-- Settings of the firm and technical settings: only what differs from the catalogue of the contracts is stored.

CREATE TABLE settings (
  key text PRIMARY KEY CHECK (key ~ '^(firm|technical)\.[a-z]{2,32}\.[A-Za-z0-9-]{1,32}$'),
  value jsonb NOT NULL CHECK (jsonb_typeof(value) = 'boolean' OR (jsonb_typeof(value) = 'string' AND length(value #>> '{}') <= 500)),
  version integer NOT NULL DEFAULT 1,
  updated_by uuid NOT NULL REFERENCES users (id),
  on_behalf_of_id uuid REFERENCES users (id),
  updated_at timestamptz(3) NOT NULL DEFAULT now()
);
-- Former values, encrypted by the API: what was the IBAN that day, and who changed it.
CREATE TABLE setting_versions (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  key text NOT NULL,
  -- Null when it was still the value of the catalogue.
  previous_cipher bytea,
  changed_by uuid NOT NULL REFERENCES users (id),
  on_behalf_of_id uuid REFERENCES users (id),
  changed_at timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX setting_versions_key ON setting_versions (key, changed_at);
CALL app.append_only('setting_versions');

GRANT CREATE ON SCHEMA app TO legarec_definer;
GRANT SELECT (key, value, version, updated_by, on_behalf_of_id), INSERT (key, value, updated_by, on_behalf_of_id), UPDATE (value, version, updated_by, on_behalf_of_id, updated_at) ON settings TO legarec_definer;
GRANT INSERT (id, key, previous_cipher, changed_by, on_behalf_of_id) ON setting_versions TO legarec_definer;
SET LOCAL ROLE legarec_definer;
-- Technical settings: the Director, or the Developer on their behalf. Those of the firm: the Director, or the manager on their
-- behalf. Identity, account and cheques of the firm: the Director alone.
CREATE FUNCTION app.save_setting(wanted text, new_value jsonb, version_id uuid, previous bytea) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NOT (CASE
    WHEN wanted IN ('firm.cabinet.siren', 'firm.cabinet.vat', 'firm.cabinet.iban', 'firm.cabinet.bic', 'firm.cabinet.holder', 'firm.cabinet.bankName',
      'firm.cabinet.chequePayee', 'firm.cabinet.chequeAddress') THEN coalesce(app.staff_role() = 'DIRECTOR', false)
    WHEN wanted LIKE 'firm.%' THEN app.acts_as_director('ADMINISTRATIVE')
    WHEN wanted LIKE 'technical.%' THEN app.acts_as_director('TECHNICAL')
    ELSE false
  END) THEN
    PERFORM app.refuse('42501');
  END IF;
  INSERT INTO public.settings AS s (key, value, updated_by, on_behalf_of_id) VALUES (wanted, new_value, app.user_id(), app.on_behalf_of())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, version = s.version + 1, updated_by = EXCLUDED.updated_by, on_behalf_of_id = EXCLUDED.on_behalf_of_id, updated_at = now();
  INSERT INTO public.setting_versions (id, key, previous_cipher, changed_by, on_behalf_of_id) VALUES (version_id, wanted, previous, app.user_id(), app.on_behalf_of());
END
$$;
GRANT EXECUTE ON FUNCTION app.save_setting(text, jsonb, uuid, bytea) TO legarec_staff;
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM legarec_definer;

CALL app.secure('settings');
CALL app.secure('setting_versions');
CREATE POLICY definer_all ON settings TO legarec_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_add ON setting_versions FOR INSERT TO legarec_definer WITH CHECK (true);
CREATE POLICY staff_read ON settings FOR SELECT TO legarec_staff USING (
  CASE WHEN key LIKE 'firm.%' THEN (SELECT app.staff_role()) IS NOT NULL ELSE (SELECT app.staff_role()) IN ('DIRECTOR', 'DEVELOPER') END);
GRANT SELECT (key, value, version, updated_by, on_behalf_of_id, updated_at) ON settings TO legarec_staff;
CREATE POLICY worker_read ON settings FOR SELECT TO legarec_worker USING (true);
GRANT SELECT (key, value) ON settings TO legarec_worker;
CREATE POLICY director_read ON setting_versions FOR SELECT TO legarec_staff USING ((SELECT app.staff_role()) = 'DIRECTOR');
GRANT SELECT (id, key, changed_by, on_behalf_of_id, changed_at) ON setting_versions TO legarec_staff;
