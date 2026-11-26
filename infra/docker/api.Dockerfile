# API, worker and migrations: one image, three commands (docker-compose.yml).
FROM node:26.13.1-trixie-slim@sha256:abe7e5a82b61a8ef67b315b85497c9e65173387ccf2f4a029248184b8e020be5 AS base
# The version named by packageManager in package.json: Node 26 no longer ships corepack.
RUN npm install --global --ignore-scripts --no-audit --no-fund pnpm@12.23.0
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/contracts/package.json packages/contracts/

FROM base AS build
RUN pnpm install --frozen-lockfile --filter legarec --filter @legarec/api...
COPY packages/contracts packages/contracts
COPY apps/api apps/api
RUN pnpm --filter @legarec/api build

# Only what the programs need once they are built.
FROM base AS production
RUN pnpm install --frozen-lockfile --prod --filter @legarec/api...

FROM node:26.13.1-trixie-slim@sha256:abe7e5a82b61a8ef67b315b85497c9e65173387ccf2f4a029248184b8e020be5
# Chromium of Debian for the PDF of the worker (Playwright drives it, without JavaScript nor network), and its fonts.
RUN apt-get update && apt-get install --yes --no-install-recommends chromium fonts-dejavu-core fonts-liberation && rm -rf /var/lib/apt/lists/*
# Nothing to install once in production.
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx /opt/yarn* /usr/local/bin/yarn /usr/local/bin/yarnpkg
ENV NODE_ENV=production
WORKDIR /app/apps/api
COPY --from=production /repo/node_modules /app/node_modules
COPY --from=production /repo/apps/api/node_modules ./node_modules
COPY --from=production /repo/packages/contracts/package.json /app/packages/contracts/package.json
COPY --from=production /repo/packages/contracts/node_modules /app/packages/contracts/node_modules
COPY --from=build /repo/apps/api/package.json ./package.json
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/templates ./templates
COPY --from=build /repo/apps/api/prisma/migrations ./prisma/migrations
COPY infra/docker/worker-health.mjs ./worker-health.mjs
# Never 1000: on the server, this number is the account used for development. Not root either.
USER 10101:10101
EXPOSE 3000
CMD ["node", "dist/main.js"]
