-- What the security review of the imports asked: a confirmed import keeps no copy of the debtors it deposited.

GRANT UPDATE (claims, errors) ON claim_imports TO legarec_partner;

-- Those confirmed before this migration.
UPDATE claim_imports SET claims = '[]', errors = '[]' WHERE status = 'CONFIRMED';
