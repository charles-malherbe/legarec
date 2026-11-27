-- The bucket of the documents (OVHcloud Object Storage): its two keys are typed in the vault like those of the other
-- services. Whoever handles a file reads them encrypted (the key that opens them is not in the database): the team, a
-- creditor and a debtor in their own request, the worker for its tasks and the purge. Nobody else, and no other key.
GRANT CREATE ON SCHEMA app TO legarec_definer;
SET LOCAL ROLE legarec_definer;
-- Someone who is no longer recognised is refused, not answered « no key »: the files would go to the disk for that.
CREATE FUNCTION app.storage_keys() RETURNS TABLE (name text, id uuid, value_cipher bytea)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF app.actor_kind() NOT IN ('STAFF', 'CREDITOR', 'DEBTOR', 'SYSTEM') THEN
    PERFORM app.refuse('42501');
  END IF;
  RETURN QUERY SELECT s.name::text, s.id, s.value_cipher FROM public.vault_secrets s
    WHERE s.name IN ('S3_ACCESS_KEY', 'S3_SECRET_KEY') AND s.kind = 'SERVICE' AND s.status = 'VALID' AND s.value_cipher IS NOT NULL;
END
$$;
GRANT EXECUTE ON FUNCTION app.storage_keys() TO legarec_staff, legarec_partner, legarec_debtor, legarec_worker;
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM legarec_definer;
