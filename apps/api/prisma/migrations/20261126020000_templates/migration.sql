-- Templates: version 1 of each is the catalogue of the contracts (texts of the mock-up); later ones are imported here, checked by
-- the API, submitted, then published by the Director or the manager on their behalf. One pending and one published at most.

CREATE TYPE template_state AS ENUM ('IMPORTED', 'RESTORED', 'WAITING', 'PUBLISHED', 'ARCHIVED', 'REJECTED', 'CANCELLED');

CREATE TABLE template_versions (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  template_code text NOT NULL CHECK (template_code ~ '^[a-z0-9-]{1,40}$'),
  -- Given when it is published: 2, 3… (1 is the catalogue).
  number integer CHECK (number BETWEEN 2 AND 100000),
  source text NOT NULL CHECK (octet_length(source) BETWEEN 1 AND 500000),
  file_name text NOT NULL CHECK (length(file_name) BETWEEN 1 AND 200),
  accepted boolean NOT NULL,
  checks jsonb NOT NULL CHECK (jsonb_typeof(checks) = 'array' AND octet_length(checks::text) <= 20000),
  has_warnings boolean NOT NULL,
  state template_state NOT NULL,
  imported_by uuid NOT NULL REFERENCES users (id),
  submitted_by uuid REFERENCES users (id),
  reviewed_by uuid REFERENCES users (id),
  on_behalf_of_id uuid REFERENCES users (id),
  review_reason text CHECK (length(review_reason) <= 500),
  published_at timestamptz(3),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT template_versions_number CHECK ((number IS NOT NULL) = (state IN ('PUBLISHED', 'ARCHIVED'))),
  CONSTRAINT template_versions_published CHECK ((published_at IS NOT NULL) = (state IN ('PUBLISHED', 'ARCHIVED')))
);
CREATE UNIQUE INDEX template_versions_numbered ON template_versions (template_code, number) WHERE number IS NOT NULL;
CREATE UNIQUE INDEX template_versions_pending ON template_versions (template_code) WHERE state IN ('IMPORTED', 'RESTORED', 'WAITING');
CREATE UNIQUE INDEX template_versions_in_force ON template_versions (template_code) WHERE state = 'PUBLISHED';
CREATE INDEX template_versions_code ON template_versions (template_code, created_at DESC);

GRANT CREATE ON SCHEMA app TO legarec_definer;
GRANT SELECT, INSERT (template_code, source, file_name, accepted, checks, has_warnings, state, imported_by, on_behalf_of_id),
  UPDATE (number, state, submitted_by, reviewed_by, on_behalf_of_id, review_reason, published_at, updated_at) ON template_versions TO legarec_definer;
SET LOCAL ROLE legarec_definer;

-- Who imports, restores and submits: the Director and the manager.
CREATE FUNCTION app.template_editor() RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'STAFF' OR app.staff_role() IS NULL OR app.staff_role() NOT IN ('DIRECTOR', 'COLLECTION_MANAGER') THEN
    PERFORM app.refuse('42501');
  END IF;
END
$$;

-- A new file replaces what was pending, unless it already waits for validation.
CREATE FUNCTION app.import_template(code text, wanted_source text, wanted_name text, ok boolean, found_checks jsonb, warned boolean, restored boolean) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM app.template_editor();
  PERFORM pg_advisory_xact_lock(hashtextextended('template:' || code, 0));
  IF EXISTS (SELECT 1 FROM public.template_versions v WHERE v.template_code = code AND v.state = 'WAITING') THEN
    PERFORM app.refuse('LG409');
  END IF;
  UPDATE public.template_versions v SET state = 'CANCELLED', updated_at = now() WHERE v.template_code = code AND v.state IN ('IMPORTED', 'RESTORED');
  INSERT INTO public.template_versions (template_code, source, file_name, accepted, checks, has_warnings, state, imported_by, on_behalf_of_id)
  VALUES (code, wanted_source, wanted_name, ok, found_checks, warned, CASE WHEN restored THEN 'RESTORED' ELSE 'IMPORTED' END::template_state, app.user_id(), app.on_behalf_of());
  PERFORM app.log(CASE WHEN restored THEN 'TEMPLATE_RESTORED' ELSE 'TEMPLATE_IMPORTED' END, NULL, NULL, '{}');
END
$$;

-- « Annuler » the import, then « Annuler » that: the file cancelled the last, within the hour, if nothing replaced it.
CREATE FUNCTION app.cancel_template(code text, undo boolean) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM app.template_editor();
  PERFORM pg_advisory_xact_lock(hashtextextended('template:' || code, 0));
  IF NOT undo THEN
    IF EXISTS (SELECT 1 FROM public.template_versions v WHERE v.template_code = code AND v.state = 'WAITING') THEN
      PERFORM app.refuse('42501');
    END IF;
    UPDATE public.template_versions v SET state = 'CANCELLED', updated_at = now() WHERE v.template_code = code AND v.state IN ('IMPORTED', 'RESTORED');
    RETURN;
  END IF;
  UPDATE public.template_versions v SET state = 'IMPORTED', updated_at = now()
  WHERE v.id = (SELECT c.id FROM public.template_versions c WHERE c.template_code = code AND c.state = 'CANCELLED' AND c.updated_at > now() - interval '1 hour'
      ORDER BY c.updated_at DESC LIMIT 1)
    AND NOT EXISTS (SELECT 1 FROM public.template_versions p WHERE p.template_code = code AND p.state IN ('IMPORTED', 'RESTORED', 'WAITING'));
  IF NOT FOUND THEN
    PERFORM app.refuse('LG404');
  END IF;
END
$$;

-- Submitted for validation: accepted by the checks, its warnings read.
CREATE FUNCTION app.submit_template(code text, acknowledged boolean) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  pending record;
BEGIN
  PERFORM app.template_editor();
  SELECT v.id, v.accepted, v.has_warnings INTO pending FROM public.template_versions v WHERE v.template_code = code AND v.state IN ('IMPORTED', 'RESTORED') FOR UPDATE;
  IF NOT FOUND OR NOT pending.accepted THEN
    PERFORM app.refuse('42501');
  END IF;
  IF pending.has_warnings AND NOT acknowledged THEN
    PERFORM app.refuse('22023');
  END IF;
  UPDATE public.template_versions v SET state = 'WAITING', submitted_by = app.user_id(), updated_at = now() WHERE v.id = pending.id;
END
$$;

-- Published, or refused, by the Director or the manager on their behalf; the version in force before is archived.
CREATE FUNCTION app.review_template(code text, approved boolean, why text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  pending uuid;
BEGIN
  IF NOT app.acts_as_director('ADMINISTRATIVE') THEN
    PERFORM app.refuse('42501');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('template:' || code, 0));
  SELECT v.id INTO pending FROM public.template_versions v WHERE v.template_code = code AND v.state = 'WAITING' FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app.refuse('42501');
  END IF;
  IF approved THEN
    UPDATE public.template_versions v SET state = 'ARCHIVED', updated_at = now() WHERE v.template_code = code AND v.state = 'PUBLISHED';
    UPDATE public.template_versions v SET state = 'PUBLISHED', published_at = now(), reviewed_by = app.user_id(), on_behalf_of_id = app.on_behalf_of(),
      review_reason = nullif(btrim(why), ''), updated_at = now(),
      number = coalesce((SELECT max(n.number) FROM public.template_versions n WHERE n.template_code = code), 1) + 1
    WHERE v.id = pending;
  ELSE
    UPDATE public.template_versions v SET state = 'REJECTED', reviewed_by = app.user_id(), on_behalf_of_id = app.on_behalf_of(), review_reason = nullif(btrim(why), ''), updated_at = now()
    WHERE v.id = pending;
  END IF;
  PERFORM app.log(CASE WHEN approved THEN 'TEMPLATE_PUBLISHED' ELSE 'TEMPLATE_REJECTED' END, NULL, NULL, '{}');
END
$$;
GRANT EXECUTE ON FUNCTION app.import_template(text, text, text, boolean, jsonb, boolean, boolean), app.cancel_template(text, boolean),
  app.submit_template(text, boolean), app.review_template(text, boolean, text) TO legarec_staff;
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM legarec_definer;

-- The team reads every version (FIRM); the worker reads those in force to write the letters.
CALL app.secure('template_versions');
CREATE POLICY definer_all ON template_versions TO legarec_definer USING (true) WITH CHECK (true);
CREATE POLICY staff_read ON template_versions FOR SELECT TO legarec_staff USING ((SELECT app.staff_role()) IS NOT NULL);
CREATE POLICY worker_read ON template_versions FOR SELECT TO legarec_worker USING (state = 'PUBLISHED');
GRANT SELECT (id, template_code, number, source, file_name, accepted, checks, has_warnings, state, imported_by, submitted_by, reviewed_by, on_behalf_of_id,
  review_reason, published_at, updated_at, created_at) ON template_versions TO legarec_staff;
GRANT SELECT (id, template_code, number, source, state) ON template_versions TO legarec_worker;
