# --- whisper.cpp -------------------------------------------------------------
# Built from source so the binary matches this image's OS/arch (a binary copied from a
# Mac won't run here). Static, so the runtime stage needs no whisper/ggml shared libraries.
FROM debian:bookworm-slim AS whisper_build

ARG WHISPER_CPP_VERSION=v1.9.4

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential cmake git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN git clone --depth 1 --branch ${WHISPER_CPP_VERSION} https://github.com/ggml-org/whisper.cpp.git /whisper.cpp

WORKDIR /whisper.cpp

# GGML_NATIVE=OFF: CI's CPU isn't the server's, so don't tune for the build machine.
RUN cmake -B build \
      -DCMAKE_BUILD_TYPE=Release \
      -DBUILD_SHARED_LIBS=OFF \
      -DGGML_NATIVE=OFF \
      -DWHISPER_BUILD_TESTS=OFF \
      -DWHISPER_BUILD_SERVER=OFF \
    && cmake --build build --config Release --target whisper-cli -j"$(nproc)"

# --- app -----------------------------------------------------------------------
FROM node:24-slim AS build_image

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

# emits dist/platform/transcription/service with main.js plus a pruned package.json + pnpm-lock.yaml
# (generatePackageJson in webpack.config.js)
RUN NX_DAEMON=false ENVIRONMENT=$BUILD_ENV pnpm nx build transcription-service

RUN node tools/scripts/prune-deploy-manifest.mjs dist/platform/transcription/service/package.json

# --- runtime -------------------------------------------------------------------
FROM node:24-slim

# CI doesn't pass --build-arg BUILD_ENV; without a default ENVIRONMENT would be "" and fail validation.
ARG BUILD_ENV=production
ENV ENVIRONMENT=${BUILD_ENV}

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV COREPACK_INTEGRITY_KEYS="0"
RUN corepack enable

# ffmpeg converts any input format to the 16kHz mono WAV whisper expects.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY --from=whisper_build /whisper.cpp/build/bin/whisper-cli /usr/local/bin/whisper-cli

# Models are large (up to ~3GB each), so they're mounted rather than baked in:
# ggml-<name>.bin files in /models, listed in WHISPER_MODELS.
ENV WHISPER_CLI_PATH=/usr/local/bin/whisper-cli
ENV WHISPER_MODELS_DIR=/models

WORKDIR /app

COPY --from=build_image /app/dist/platform/transcription/service ./

# --no-frozen-lockfile because the pruned manifest no longer matches the
# generated lockfile's workspace entries; versions stay pinned by the lockfile
RUN pnpm install --prod --ignore-scripts --no-frozen-lockfile \
    && rm -rf "$(pnpm store path)"

EXPOSE 3002

# Set last so a new version only changes this layer. CI passes both (see build-server-apps.yml);
# local builds leave them empty and the app reports "unknown".
ARG VERSION
ARG VERSION_TAG
ENV VERSION=${VERSION}
ENV VERSION_TAG=${VERSION_TAG}

CMD ["node", "main.js"]
