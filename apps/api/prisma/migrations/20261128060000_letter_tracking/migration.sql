-- What MySendingBox says of a letter afterwards, read from MySendingBox itself (a webhook names the letter, the clock asks
-- again): why it did not arrive. The same columns, written once, as for the e-mails.
ALTER TABLE sendings DROP CONSTRAINT sendings_undelivered_reason_check;
ALTER TABLE sendings ADD CONSTRAINT sendings_undelivered_reason_check
  CHECK (undelivered_reason IN ('HARD_BOUNCE', 'BOUNCE', 'SUPPRESSED', 'PROVIDER_FAILED', 'RETURNED', 'WRONG_ADDRESS', 'LOST', 'CANCELED'));

-- The route of MySendingBox, which signs nothing, learns only whether a letter it names is one this database sent for
-- real, and which: the worker then asks MySendingBox itself. A name it does not know costs no call to anybody.
GRANT CREATE ON SCHEMA app TO legarec_definer;
GRANT SELECT (simulated, provider_ref) ON sendings TO legarec_definer;
SET LOCAL ROLE legarec_definer;

CREATE FUNCTION app.letter_named(ref text) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  found uuid;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'HOOK' THEN
    PERFORM app.refuse('42501');
  END IF;
  SELECT s.id INTO found FROM public.sendings s
  WHERE s.provider_ref = ref AND s.channel IN ('LETTER', 'REGISTERED_LETTER') AND s.status = 'SENT' AND NOT s.simulated
  ORDER BY s.created_at LIMIT 1;
  RETURN found;
END
$$;

GRANT EXECUTE ON FUNCTION app.letter_named(text) TO legarec_hook;
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM legarec_definer;
