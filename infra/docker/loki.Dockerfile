# Technical logs. The configuration is part of the image.
FROM grafana/loki:3.7.10@sha256:b43c257ccfc925d4a50b8717cac61a3b51df8c48d01847936057e5c4075a24a7
COPY infra/loki/loki.yaml /etc/loki/loki.yaml
CMD ["-config.file=/etc/loki/loki.yaml"]
