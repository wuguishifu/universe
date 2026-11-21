FROM mirror.gcr.io/library/node:24-slim AS build_image

LABEL maintainer="Bo Bramer <bramer.bo@gmail.com>"
LABEL org.opencontainers.image.source=https://github.com/wuguishifu/universe

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV COREPACK_INTEGRITY_KEYS="0"
RUN corepack enable

WORKDIR /app

COPY . ./

ARG BUILD_ENV

RUN pnpm install --frozen-lockfile

# emits dist/projects/trading/bot with main.js plus a pruned package.json + pnpm-lock.yaml
# (generatePackageJson in webpack.config.cjs, which also drops the source package's "type": "module")
RUN NX_DAEMON=false ENVIRONMENT=$BUILD_ENV pnpm nx build trading-bot

RUN node tools/scripts/prune-deploy-manifest.mjs dist/projects/trading/bot/package.json

FROM mirror.gcr.io/library/node:24-slim

# CI doesn't pass --build-arg BUILD_ENV; without a default ENVIRONMENT would be "" and fail validation.
ARG BUILD_ENV=production
ENV ENVIRONMENT=${BUILD_ENV}

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV COREPACK_INTEGRITY_KEYS="0"
RUN corepack enable

WORKDIR /app

COPY --from=build_image /app/dist/projects/trading/bot ./

# --no-frozen-lockfile because the pruned manifest no longer matches the
# generated lockfile's workspace entries; versions stay pinned by the lockfile
RUN pnpm install --prod --ignore-scripts --no-frozen-lockfile \
    && rm -rf "$(pnpm store path)"

EXPOSE 3013

USER node

# Stopping the container is the kill switch: SIGTERM runs the shutdown hooks, which sell every
# position before exiting. Give it longer than SHUTDOWN_FLATTEN_TIMEOUT_MS (60s by default) to do
# that, e.g. terminationGracePeriodSeconds: 120 in Kubernetes or `docker stop -t 120`.
STOPSIGNAL SIGTERM

# Set last so a new version only changes this layer. CI passes both (see build-server-apps.yml);
# local builds leave them empty and the app reports "unknown".
ARG VERSION
ARG VERSION_TAG
ENV VERSION=${VERSION}
ENV VERSION_TAG=${VERSION_TAG}

CMD ["node", "main.js"]
