# Collector of the technical logs. The configuration is part of the image.
FROM fluent/fluent-bit:5.2.1@sha256:8db4e4fc1009fd6dabac7e6a3366ad006ca0c3a140ea938db79044d52964943d
COPY infra/loki/fluent-bit.yaml /fluent-bit/etc/legarec.yaml
USER 10113:10113
CMD ["-c", "/fluent-bit/etc/legarec.yaml"]
