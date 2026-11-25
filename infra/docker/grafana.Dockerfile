# Technical logs on screen. The password is read from the file of the container.
FROM grafana/grafana:13.3.2@sha256:81556409ba48b2b922e0adb69a2511337d8ba7578f11962eefa6149a2d815101
COPY infra/grafana/provisioning /etc/grafana/provisioning
COPY --chmod=0755 infra/grafana/legarec-grafana /usr/local/bin/legarec-grafana
USER 0:0
RUN install -d -o 10114 -g 10114 -m 700 /var/lib/grafana
USER 10114:10114
ENTRYPOINT ["legarec-grafana"]
