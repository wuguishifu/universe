# The worker runs natively on the Mac mini (whisper on Metal), not from this image: Deploy Server
# App builds it so it can copy /app out as the release bundle the mini installs. So there's no
# ffmpeg or whisper-cli here; the mini installs those with Homebrew.
#
# The bundle also carries the diarizer (a uv project in /app/diarizer), which each host installs
# itself with `uv sync --frozen --no-dev --no-editable` and points DIARIZER_PATH at. To run this
# image on a Linux GPU host instead, it would need ffmpeg, a CUDA whisper-cli, uv plus that sync
# (the lockfile pins CUDA torch on Linux), and the models mounted in.
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

# emits dist/platform/transcription/worker with main.js plus a pruned package.json + pnpm-lock.yaml
# (generatePackageJson in webpack.config.js)
RUN NX_DAEMON=false ENVIRONMENT=$BUILD_ENV pnpm nx build transcription-worker

RUN node tools/scripts/prune-deploy-manifest.mjs dist/platform/transcription/worker/package.json

FROM mirror.gcr.io/library/node:24-slim

# CI doesn't pass --build-arg BUILD_ENV; without a default ENVIRONMENT would be "" and fail validation.
ARG BUILD_ENV=production
ENV ENVIRONMENT=${BUILD_ENV}

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV COREPACK_INTEGRITY_KEYS="0"
RUN corepack enable

WORKDIR /app

COPY --from=build_image /app/dist/platform/transcription/worker ./
COPY --from=build_image /app/platform/transcription/diarizer ./diarizer

# --no-frozen-lockfile because the pruned manifest no longer matches the
# generated lockfile's workspace entries; versions stay pinned by the lockfile
RUN pnpm install --prod --ignore-scripts --no-frozen-lockfile \
    && rm -rf "$(pnpm store path)"

# Set last so a new version only changes this layer. CI passes both (see build-server-apps.yml);
# local builds leave them empty and the app reports "unknown".
ARG VERSION
ARG VERSION_TAG
ENV VERSION=${VERSION}
ENV VERSION_TAG=${VERSION_TAG}

CMD ["node", "main.js"]
