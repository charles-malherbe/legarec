# Automations (n8n.legarec.fr, from the addresses of the firm only). The same version as the n8n the firm already ran, so
# that its data are taken over as they are. The key is read from the file of the container.
FROM n8nio/n8n:2.48.7@sha256:fabce3e9678a07d2dde83bd8f5124017f3ec457d0a3fc6b63bb4cec465d63861
COPY --chmod=0755 infra/n8n/legarec-n8n /usr/local/bin/legarec-n8n
USER 0:0
# A volume takes the owner of this folder the first time it is used.
RUN install -d -o 10117 -g 10117 -m 700 /home/node/.n8n
USER 10117:10117
EXPOSE 5678
ENTRYPOINT ["tini", "--", "legarec-n8n"]
