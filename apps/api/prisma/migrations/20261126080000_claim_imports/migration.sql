-- Imports of claims by a creditor: the API reads the file and keeps what it understood, line by line; nothing is created
-- before the creditor confirms, then each claim is deposited as one typed by hand (`app.creditor_deposit`). Unconfirmed
-- imports go after 30 days (docs/api.md, « Conservation »).

CREATE TYPE import_status AS ENUM ('PENDING', 'CONFIRMED');

CREATE TABLE claim_imports (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  creditor_id uuid NOT NULL REFERENCES creditors (id),
  uploaded_by uuid NOT NULL REFERENCES users (id),
  status import_status NOT NULL DEFAULT 'PENDING',
  lines integer NOT NULL CHECK (lines BETWEEN 0 AND 5000),
  valid integer NOT NULL CHECK (valid BETWEEN 0 AND lines),
  total_cents bigint NOT NULL CHECK (total_cents >= 0),
  -- The claims understood, grouped by debtor, as the deposit takes them; and the lines refused, with why.
  claims jsonb NOT NULL CHECK (jsonb_typeof(claims) = 'array' AND octet_length(claims::text) <= 4000000),
  errors jsonb NOT NULL CHECK (jsonb_typeof(errors) = 'array' AND octet_length(errors::text) <= 200000),
  created_count integer,
  confirmed_at timestamptz(3),
  expires_at timestamptz(3) NOT NULL DEFAULT now() + interval '30 days',
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT claim_imports_confirmed CHECK ((status = 'CONFIRMED') = (confirmed_at IS NOT NULL))
);
CREATE INDEX claim_imports_expiry ON claim_imports (expires_at) WHERE status = 'PENDING';

-- Those of the creditor, by its accounts; never by the team (docs/api.md, THREAD: imports, never the officer).
CALL app.secure('claim_imports');
CREATE POLICY partner_own ON claim_imports FOR SELECT TO legarec_partner USING (creditor_id = (SELECT app.partner_creditor()));
CREATE POLICY partner_add ON claim_imports FOR INSERT TO legarec_partner
  WITH CHECK (creditor_id = (SELECT app.partner_creditor()) AND uploaded_by = (SELECT app.user_id()) AND status = 'PENDING' AND confirmed_at IS NULL);
CREATE POLICY partner_confirm ON claim_imports FOR UPDATE TO legarec_partner
  USING (creditor_id = (SELECT app.partner_creditor()) AND status = 'PENDING' AND expires_at > now())
  WITH CHECK (creditor_id = (SELECT app.partner_creditor()) AND status = 'CONFIRMED');
CREATE POLICY staff_read ON claim_imports FOR SELECT TO legarec_staff USING ((SELECT app.staff_role()) IN ('DIRECTOR', 'COLLECTION_MANAGER'));
CREATE POLICY retention_purge ON claim_imports FOR DELETE TO legarec_retention USING (status = 'PENDING' AND expires_at < now());
CREATE POLICY retention_read ON claim_imports FOR SELECT TO legarec_retention USING (true);
GRANT SELECT (id, creditor_id, uploaded_by, status, lines, valid, total_cents, claims, errors, created_count, confirmed_at, expires_at, created_at),
  INSERT (id, creditor_id, uploaded_by, status, lines, valid, total_cents, claims, errors), UPDATE (status, created_count, confirmed_at) ON claim_imports TO legarec_partner;
GRANT SELECT (id, creditor_id, uploaded_by, status, lines, valid, total_cents, created_count, confirmed_at, created_at) ON claim_imports TO legarec_staff;
GRANT SELECT (id, status, expires_at), DELETE ON claim_imports TO legarec_retention;
