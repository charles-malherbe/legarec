-- Justified override of the contact cap (question 214): the Collection manager, or the Director on the cases they act on,
-- may send one reminder by e-mail beyond the cap of the debtor, with a reason. The reason stays on the line, read with the
-- case and gone with it; the audit log only says that it happened.
ALTER TABLE sendings ADD COLUMN cap_override_reason text
  CHECK (char_length(btrim(cap_override_reason)) BETWEEN 10 AND 500 AND cap_override_reason !~ '[[:cntrl:]]');
ALTER TABLE sendings ADD CONSTRAINT sendings_override_reminder CHECK (cap_override_reason IS NULL OR (channel = 'EMAIL' AND level IS NOT NULL));

-- Whoever writes an override must hold one of the two roles: the API asks it, the database holds it.
CREATE FUNCTION app.check_cap_override() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF app.staff_role() IS DISTINCT FROM 'COLLECTION_MANAGER' AND app.staff_role() IS DISTINCT FROM 'DIRECTOR' THEN
    RAISE EXCEPTION 'an override of the cap is for the manager or the director' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER sending_cap_override BEFORE INSERT ON sendings FOR EACH ROW WHEN (NEW.cap_override_reason IS NOT NULL)
  EXECUTE FUNCTION app.check_cap_override();

GRANT SELECT (cap_override_reason), INSERT (cap_override_reason) ON sendings TO legarec_staff;
