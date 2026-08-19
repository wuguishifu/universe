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

RUN NX_DAEMON=false ENVIRONMENT=$BUILD_ENV pnpm nx build silver

# remove development dependencies
RUN npm prune --production --legacy-peer-deps

FROM node:22-slim

ARG VERSION
ARG BUILD_ENV
ENV VERSION=${VERSION}
ENV ENVIRONMENT=${BUILD_ENV}

# ffmpeg is required by yt-dlp for audio extraction; python3 is required to run yt-dlp.
# yt-dlp comes from GitHub releases rather than apt because YouTube frequently
# breaks outdated versions.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg python3 curl ca-certificates \
    && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && apt-get purge -y curl \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build_image /app/dist/apps/silver ./dist
COPY --from=build_image /app/node_modules ./node_modules

EXPOSE 3001

# self-update yt-dlp on startup; don't block startup if the update fails
CMD ["sh", "-c", "yt-dlp -U || true; exec node dist/main.js"]
