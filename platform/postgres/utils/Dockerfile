FROM node:24-slim AS build_image

LABEL maintainer="Bo Bramer <bramer.bo@gmail.com>"
LABEL org.opencontainers.image.source=https://github.com/wuguishifu/universe

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV COREPACK_INTEGRITY_KEYS="0"
RUN corepack enable

WORKDIR /app

COPY . ./

RUN pnpm install --frozen-lockfile

# emits dist/platform/postgres/migrations with a self-contained migrate.mjs (dependencies bundled
# by esbuild) and the drizzle migrations folder next to it, where migrate.mjs looks by default
RUN NX_DAEMON=false pnpm nx bundle:migrate postgres-utils

FROM node:24-slim

# Runs against the homelab database; without a TTY migrate.mjs skips its confirmation prompt.
ARG BUILD_ENV=production
ENV ENVIRONMENT=${BUILD_ENV}

WORKDIR /app

COPY --from=build_image /app/dist/platform/postgres/migrations ./

# Set last so a new version only changes this layer. CI passes both (see build-server-apps.yml);
# migrate.mjs doesn't read them, they just identify the image like the other server apps.
ARG VERSION
ARG VERSION_TAG
ENV VERSION=${VERSION}
ENV VERSION_TAG=${VERSION_TAG}

# Needs UNIVERSE_DB_CONNECTION_STRING (a role that owns the universe database's schema).
CMD ["node", "migrate.mjs"]
