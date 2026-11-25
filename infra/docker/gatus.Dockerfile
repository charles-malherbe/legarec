# Monitoring. The official image has no shell, which the file of values and the health check need.
FROM twinproduction/gatus:v5.38.0@sha256:085ed63da963728965d00a3c78aa6167e3bf135218485b893201758e079e8415 AS gatus

FROM alpine:3.24.4@sha256:f59abe656b692d901e184be3445e084786602108599d2a51d229c0f5a48c71bf
COPY --from=gatus /gatus /usr/local/bin/gatus
COPY --from=gatus /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --chmod=0755 infra/gatus/legarec-gatus /usr/local/bin/legarec-gatus
COPY infra/gatus/public.yaml infra/gatus/internal.yaml /etc/gatus/
# A volume takes the owner of this folder the first time it is used.
RUN install -d -o 10111 -g 10111 -m 700 /data
USER 10111:10111
EXPOSE 8080
CMD ["legarec-gatus"]
