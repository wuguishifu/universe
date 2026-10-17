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

# emits dist/projects/thermo-automation/service with main.js plus a pruned package.json + pnpm-lock.yaml
# (generatePackageJson in webpack.config.js), and the SPA in dist/projects/thermo-automation/web
RUN NX_DAEMON=false ENVIRONMENT=$BUILD_ENV pnpm nx run-many -t build \
    -p thermo-automation-service thermo-automation-web

RUN node tools/scripts/prune-deploy-manifest.mjs dist/projects/thermo-automation/service/package.json

FROM mirror.gcr.io/library/node:24-slim

# CI doesn't pass --build-arg BUILD_ENV; without a default ENVIRONMENT would be "" and fail validation.
ARG BUILD_ENV=production
ENV ENVIRONMENT=${BUILD_ENV}

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV COREPACK_INTEGRITY_KEYS="0"
RUN corepack enable

WORKDIR /app

COPY --from=build_image /app/dist/projects/thermo-automation/service ./

# --no-frozen-lockfile because the pruned manifest no longer matches the
# generated lockfile's workspace entries; versions stay pinned by the lockfile
RUN pnpm install --prod --ignore-scripts --no-frozen-lockfile \
    && rm -rf "$(pnpm store path)"

# The service serves the SPA from here.
COPY --from=build_image /app/dist/projects/thermo-automation/web ./web
ENV WEB_ROOT=/app/web

EXPOSE 3009

USER node

# Set last so a new version only changes this layer. CI passes both (see build-server-apps.yml);
# local builds leave them empty and the app reports "unknown".
ARG VERSION
ARG VERSION_TAG
ENV VERSION=${VERSION}
ENV VERSION_TAG=${VERSION_TAG}

CMD ["node", "main.js"]
