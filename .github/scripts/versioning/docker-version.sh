#!/usr/bin/env bash

set -e
if [ $# -lt 3 ]; then
  echo "Usage: $0 <registry_host> <registry_path> <version>"
  echo "Example: $0 ghcr.io wuguishifu/universe/topaz 1.0.0 production"
  exit 1
fi

REGISTRY_HOST=$1
REGISTRY_PATH=$2
VERSION=$3

CI_COMMIT_SHORT_SHA=$(git rev-parse --short=8 HEAD)
DOCKER_TAG=$VERSION-${CI_COMMIT_SHORT_SHA}
DOCKER_IMAGE_BASE=${REGISTRY_HOST}/${REGISTRY_PATH}
DOCKER_IMAGE=${DOCKER_IMAGE_BASE}:${DOCKER_TAG}
DOCKER_IMAGE_LATEST=${DOCKER_IMAGE_BASE}:latest

echo "Docker tag: ${DOCKER_TAG}"
echo "Docker image: ${DOCKER_IMAGE}"
echo "Docker image latest: ${DOCKER_IMAGE_LATEST}"

if [ -n "$GITHUB_OUTPUT" ]; then
  echo "docker_tag=${DOCKER_TAG}" >> $GITHUB_OUTPUT
  echo "docker_image=${DOCKER_IMAGE}" >> $GITHUB_OUTPUT
  echo "docker_image_latest=${DOCKER_IMAGE_LATEST}" >> $GITHUB_OUTPUT
fi
