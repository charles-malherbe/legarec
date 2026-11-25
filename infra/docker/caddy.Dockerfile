# Reverse proxy: the only container that publishes a port. Its configuration is part of the image.
FROM caddy:2.11.9-alpine@sha256:003a97808e781aa9f7e75cc2f43d34d461099031faf5e20faefb9f61126836f0
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
# The right to open a port under 1024 is not needed in a container, and would keep the program from starting without it.
# Certificates and their keys: a volume takes the owner of this folder the first time it is used.
RUN chown -R 10110:10110 /data /config && chmod 700 /data /config \
  && setcap -r /usr/bin/caddy
USER 10110:10110
EXPOSE 80 443 443/udp
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile", "--envfile", "/run/secrets/caddy"]
