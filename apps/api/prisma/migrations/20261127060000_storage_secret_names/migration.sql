-- The files are stored at OVHcloud, not at Scaleway (decision of 26/11/2026): the names of the keys no longer name a provider.
-- A renamed value keeps the rows of the vault: nothing is typed again. The audit journal writes the name as text: a line
-- written before would keep the old one. No base holds such a line yet (nothing is in service).
ALTER TYPE secret_name RENAME VALUE 'SCW_ACCESS_KEY' TO 'S3_ACCESS_KEY';
ALTER TYPE secret_name RENAME VALUE 'SCW_SECRET_KEY' TO 'S3_SECRET_KEY';
