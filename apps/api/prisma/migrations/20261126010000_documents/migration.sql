-- Documents: files received or generated, kept on the disk of the server (a volume in production) until the bucket of
-- lot X. A file is read only once ClamAV has found it clean; the copy of the creditor never carries the access code.

CREATE TYPE document_category AS ENUM ('REMINDER_LETTER', 'FORMAL_NOTICE', 'PAYMENT_PLAN', 'INVOICE', 'EVIDENCE', 'COURT', 'REMITTANCE', 'RECEIPT');
CREATE TYPE document_kind AS ENUM ('PDF', 'DOCX', 'PNG', 'JPEG');
CREATE TYPE document_source AS ENUM ('UPLOAD', 'GENERATED', 'CREDITOR', 'DEBTOR');
CREATE TYPE scan_status AS ENUM ('PENDING', 'CLEAN', 'INFECTED', 'FAILED');

ALTER TABLE outbox DROP CONSTRAINT outbox_queue_check,
  ADD CONSTRAINT outbox_queue_check CHECK (queue IN ('email', 'staff-email', 'sms', 'letter', 'pdf', 'imap', 'reminders', 'maintenance', 'documents'));

CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  -- Without a case: to be filed, by the manager only.
  case_id uuid,
  creditor_id uuid,
  category document_category NOT NULL,
  kind document_kind NOT NULL,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  -- As it was named by whoever sent it: shown, never used as a name on the disk.
  original_name text NOT NULL CHECK (length(original_name) BETWEEN 1 AND 255),
  storage_key text NOT NULL UNIQUE CHECK (storage_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 15728640),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  source document_source NOT NULL,
  author_id uuid REFERENCES users (id),
  shared_with_creditor_at timestamptz(3),
  shared_by uuid REFERENCES users (id),
  visible_to_debtor boolean NOT NULL DEFAULT false,
  contains_access_code boolean NOT NULL DEFAULT false,
  scan_status scan_status NOT NULL DEFAULT 'PENDING',
  scanned_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT documents_case CHECK (case_id IS NULL OR creditor_id IS NOT NULL),
  FOREIGN KEY (case_id, creditor_id) REFERENCES cases (id, creditor_id),
  UNIQUE (id, case_id),
  -- Shared, or shown to the debtor: attached to a case, clean, and without the code that opens the cases of all creditors.
  CONSTRAINT documents_shared CHECK (shared_with_creditor_at IS NULL OR (case_id IS NOT NULL AND scan_status = 'CLEAN' AND NOT contains_access_code)),
  CONSTRAINT documents_debtor CHECK (NOT visible_to_debtor OR (case_id IS NOT NULL AND scan_status = 'CLEAN' AND NOT contains_access_code)),
  CONSTRAINT documents_scanned CHECK ((scan_status = 'PENDING') = (scanned_at IS NULL))
);
CREATE INDEX documents_case ON documents (case_id, created_at DESC);
CREATE INDEX documents_to_file ON documents (created_at DESC) WHERE case_id IS NULL;

ALTER TABLE receipts ADD FOREIGN KEY (document_id) REFERENCES documents (id);

CALL app.secure_case_table('documents');
-- Not filed yet: the manager alone (docs/api.md, « Lignes sans dossier »), and whoever sent it.
CREATE POLICY staff_to_file ON documents FOR SELECT TO legarec_staff
  USING (case_id IS NULL AND ((SELECT app.staff_role()) = 'COLLECTION_MANAGER' OR author_id = (SELECT app.user_id())));
CREATE POLICY staff_upload_unfiled ON documents FOR INSERT TO legarec_staff WITH CHECK (case_id IS NULL AND (SELECT app.staff_role()) IN ('DIRECTOR', 'COLLECTION_MANAGER', 'CLAIMS_OFFICER'));
-- Received as it comes: unscanned, in one's own name, neither shared nor shown.
CREATE POLICY staff_received ON documents AS RESTRICTIVE FOR INSERT TO legarec_staff
  WITH CHECK (author_id = (SELECT app.user_id()) AND source = 'UPLOAD' AND scan_status = 'PENDING' AND shared_with_creditor_at IS NULL AND NOT visible_to_debtor AND NOT contains_access_code);
-- What the team changes afterwards: neither the case, nor the scan, nor the file (filing comes with its own function).
CREATE POLICY partner_read ON documents FOR SELECT TO legarec_partner
  USING (shared_with_creditor_at IS NOT NULL AND case_id IN (SELECT c.id FROM public.cases c));
CREATE POLICY debtor_read ON documents FOR SELECT TO legarec_debtor
  USING (visible_to_debtor AND case_id IN (SELECT c.id FROM public.cases c));
GRANT SELECT (id, case_id, creditor_id, category, kind, title, original_name, storage_key, size_bytes, sha256, source, author_id, shared_with_creditor_at, shared_by,
  visible_to_debtor, contains_access_code, scan_status, scanned_at, created_at),
  INSERT (id, case_id, creditor_id, category, kind, title, original_name, storage_key, size_bytes, sha256, source, author_id, visible_to_debtor, contains_access_code, scan_status),
  UPDATE (category, title, shared_with_creditor_at, shared_by) ON documents TO legarec_staff;
GRANT SELECT (id, case_id, creditor_id, category, kind, title, original_name, storage_key, size_bytes, sha256, source, author_id, shared_with_creditor_at,
  visible_to_debtor, contains_access_code, scan_status, scanned_at, created_at),
  INSERT (id, case_id, creditor_id, category, kind, title, original_name, storage_key, size_bytes, sha256, source, visible_to_debtor, contains_access_code, scan_status, scanned_at),
  UPDATE (scan_status, scanned_at) ON documents TO legarec_worker;
GRANT SELECT (id, case_id, creditor_id, category, kind, title, original_name, storage_key, size_bytes, created_at) ON documents TO legarec_partner, legarec_debtor;
