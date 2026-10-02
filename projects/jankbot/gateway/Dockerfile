FROM node:22-slim AS build_image

LABEL maintainer="Bo Bramer <bramer.bo@gmail.com>"
LABEL org.opencontainers.image.source=https://github.com/wuguishifu/universe

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV COREPACK_INTEGRITY_KEYS="0"
RUN corepack enable

WORKDIR /app

COPY . ./

ARG BUILD_ENV
ARG VERSION

ENV VERSION=${VERSION}

RUN pnpm install --frozen-lockfile

# emits dist/projects/jankbot/gateway with main.js plus a pruned package.json + pnpm-lock.yaml
# (generatePackageJson in webpack.config.js)
RUN NX_DAEMON=false ENVIRONMENT=$BUILD_ENV pnpm nx build jankbot-gateway

RUN node tools/scripts/prune-deploy-manifest.mjs dist/projects/jankbot/gateway/package.json

FROM node:22-slim

ARG VERSION
# CI doesn't pass --build-arg BUILD_ENV; without a default ENVIRONMENT would be "" and fail validation.
ARG BUILD_ENV=production
ENV VERSION=${VERSION}
ENV ENVIRONMENT=${BUILD_ENV}

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV COREPACK_INTEGRITY_KEYS="0"
RUN corepack enable

WORKDIR /app

COPY --from=build_image /app/dist/projects/jankbot/gateway ./

# No system packages: the gateway forwards raw Opus packets; jankbot-core decodes them.

# --no-frozen-lockfile because the pruned manifest no longer matches the
# generated lockfile's workspace entries; versions stay pinned by the lockfile
RUN pnpm install --prod --ignore-scripts --no-frozen-lockfile \
    && rm -rf "$(pnpm store path)"

EXPOSE 3004

CMD ["node", "main.js"]
