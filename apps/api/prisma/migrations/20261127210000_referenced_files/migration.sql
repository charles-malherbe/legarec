-- The sweep of the files that no row points at (src/platform/storage/sweep.ts): the purge lists the storage and asks,
-- for the keys it found, which ones a row holds. It reads no table for that: only this answer, a key it already has.
-- Every column that holds a storage key is read HERE, and nowhere else: a column missing from this function would have
-- its files erased (test/schema.test.ts lists the columns and fails on a new one).
-- A document erased by the retention keeps its row and its key: its file belongs to the purge of the documents
-- (« document-files »), which erases and counts it. It is answered as held, so that the two never judge the same file.
GRANT SELECT (storage_key) ON documents TO legarec_definer;
GRANT CREATE ON SCHEMA app TO legarec_definer;
SET LOCAL ROLE legarec_definer;
CREATE FUNCTION app.referenced_files(keys text[]) RETURNS SETOF text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  -- The purge alone; and never a question larger than a batch of the sweep.
  IF current_setting('role') <> 'legarec_retention' OR keys IS NULL OR cardinality(keys) > 1000 THEN
    PERFORM app.refuse('42501');
  END IF;
  RETURN QUERY SELECT d.storage_key FROM public.documents d WHERE d.storage_key = ANY (keys);
END
$$;
REVOKE ALL ON FUNCTION app.referenced_files(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.referenced_files(text[]) TO legarec_retention;
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM legarec_definer;

-- The purge reads its own journal (kinds, counts and dates, nothing else is there): whether the sweep of the night is
-- suspended since a restoration (« orphan-files-held », lifted by « orphan-files-resumed »). The journal stays append-only.
CREATE POLICY retention_read ON retention_runs FOR SELECT TO legarec_retention USING (true);
GRANT SELECT (id, kind, ran_at) ON retention_runs TO legarec_retention;
