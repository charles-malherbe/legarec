-- The files are stored at OVHcloud, not at Scaleway (decision of 26/11/2026): the names of the keys no longer name a provider.
-- A renamed value keeps its rows (vault, audit journal): nothing is typed again.
ALTER TYPE secret_name RENAME VALUE 'SCW_ACCESS_KEY' TO 'S3_ACCESS_KEY';
ALTER TYPE secret_name RENAME VALUE 'SCW_SECRET_KEY' TO 'S3_SECRET_KEY';
