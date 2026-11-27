# One portal: static files and a small server, reached through Caddy only. The same file for the three of them.
FROM node:26.13.1-trixie-slim@sha256:abe7e5a82b61a8ef67b315b85497c9e65173387ccf2f4a029248184b8e020be5 AS build
ARG PORTAL
# Public, like everything in a page: never a secret.
ARG VITE_API_URL
# espace: parts shown before the API answers them (decision 194), none unless named; the other portals ignore it.
ARG VITE_FEATURES=
# The version named by packageManager in package.json: Node 26 no longer ships corepack.
RUN npm install --global --ignore-scripts --no-audit --no-fund pnpm@12.23.0
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json postcss.config.mjs ./
COPY packages packages
COPY apps/${PORTAL} apps/${PORTAL}
RUN pnpm install --frozen-lockfile --filter legarec --filter "@legarec/${PORTAL}..."
RUN test -n "$VITE_API_URL" && VITE_API_URL="$VITE_API_URL" VITE_FEATURES="$VITE_FEATURES" pnpm --filter "@legarec/${PORTAL}" build
# The simulated API never ships.
RUN ! grep -rlE "mockServiceWorker|setupWorker" "apps/${PORTAL}/dist"
RUN test -z "$(find "apps/${PORTAL}/dist" -name "*.map")"

FROM caddy:2.11.9-alpine@sha256:003a97808e781aa9f7e75cc2f43d34d461099031faf5e20faefb9f61126836f0
ARG PORTAL
COPY infra/caddy/portail.Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/${PORTAL}/dist /srv
# The right to open a port under 1024, unused here, would keep the program from starting without it.
RUN setcap -r /usr/bin/caddy
USER 10103:10103
EXPOSE 8080
