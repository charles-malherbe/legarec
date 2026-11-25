# PostgreSQL with pgBackRest: the server sends its journal (WAL) to the backups by itself, so both live in one image.
# The same image makes the backups and tries their restoration (docker-compose.yml).
FROM postgres:17.12@sha256:87c8b42f423b45d5247e6aa8fdb2e7762fec164c68a50fe3eb07e7bfcaf4dbcf
ENV PGBACKREST_MINIMUM=2.59.3
# From the repository of PostgreSQL, already trusted by the image, which only keeps the latest versions: a minimum is checked.
RUN apt-get update \
  && apt-get install --yes --no-install-recommends pgbackrest ca-certificates curl \
  && dpkg --compare-versions "$(dpkg-query --showformat='${Version}' --show pgbackrest)" ge "$PGBACKREST_MINIMUM" \
  && rm -rf /var/lib/apt/lists/* /etc/pgbackrest.conf \
  && install -d -o postgres -g postgres -m 700 /restauration
COPY infra/postgres/postgresql.conf infra/postgres/pg_hba.conf /etc/legarec/
COPY infra/postgres/pgbackrest.conf /etc/pgbackrest/pgbackrest.conf
COPY --chmod=0755 infra/postgres/legarec-* /usr/local/bin/
COPY apps/api/prisma/bootstrap.sql /usr/local/share/legarec/bootstrap.sql
# Run by the official entry point, once, when the data folder is empty.
RUN ln -s /usr/local/bin/legarec-roles /docker-entrypoint-initdb.d/10-legarec.sh
# The server only hears its two networks and its local socket; its data belongs to `postgres`, as whom everything runs.
USER postgres
ENTRYPOINT ["legarec-postgres"]
CMD ["postgres", "-c", "config_file=/etc/legarec/postgresql.conf"]
