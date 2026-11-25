# Queues. The configuration is part of the image; the password is read from the file of the container.
FROM valkey/valkey:8.1.12@sha256:5032c4dd7abe08d6fd9382054608183e2bf1f7e3895ef619b8784698454325f7
COPY infra/valkey/valkey.conf /etc/valkey/valkey.conf
COPY --chmod=0755 infra/valkey/legarec-valkey infra/valkey/legarec-valkey-health /usr/local/bin/
# A volume takes the owner of this folder the first time it is used.
RUN chown 10115:10115 /data && chmod 700 /data
USER 10115:10115
CMD ["legarec-valkey"]
