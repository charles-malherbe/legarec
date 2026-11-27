# Antivirus: clamd and the update of its signatures, without root. The configuration is part of the image.
# The signatures of the day the image was published come with it: clamd starts without the Internet, then freshclam updates them.
FROM clamav/clamav:1.5.5@sha256:64e30c0bf976198024deb3dc6d5cfe2485fb969c0f73549ba0fdb364b9469614
COPY infra/clamav/clamd.conf infra/clamav/freshclam.conf /etc/clamav/
# A volume takes the content and the owner of this folder the first time it is used.
RUN chown -R 10116:10116 /var/lib/clamav && chmod 700 /var/lib/clamav
USER 10116:10116
# The start script of the image for an account that is not root.
ENTRYPOINT ["/init-unprivileged"]
