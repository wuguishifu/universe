#!/usr/bin/env bash

set -e
if [ $# -lt 1 ]; then
  echo "Usage: $0 <app_name> [major|minor|patch]"
  echo "Example: $0 iridium patch"
  exit 1
fi

APP_NAME=$1
BUMP_TYPE=${2:-patch}

if [[ ! "$APP_NAME" =~ ^[a-z0-9]+$ ]]; then
  echo "Invalid app name: $APP_NAME (^[a-z\d]+$ expected)"
  exit 1
elif [[ ! "$BUMP_TYPE" =~ ^(major|minor|patch)$ ]]; then
  echo "Invalid bump type: $BUMP_TYPE (major, minor or patch expected)"
  exit 1
fi

LAST_TAG=$(git ls-remote --refs --tags origin "${APP_NAME}-v*" | cut -f2 | sed 's/refs\/tags\///' | sort -V -r | head -1)
if [ -z "$LAST_TAG" ]; then
  LAST_TAG="${APP_NAME}-v1.0.0"
fi
echo "Last tag: $LAST_TAG"

VERSION_ONLY=$(echo $LAST_TAG | sed "s/^${APP_NAME}-v//")
echo "Version only: $VERSION_ONLY"

IFS='.' read -r MAJOR MINOR PATCH <<< "$VERSION_ONLY"
echo "Parsed version components: MAJOR=$MAJOR, MINOR=$MINOR, PATCH=$PATCH"

if [[ -z "$MAJOR" || -z "$MINOR" || -z "$PATCH" ]]; then
  echo "Failed to parse version components from $VERSION_ONLY"
  echo "Last tag: $LAST_TAG"
  exit 1
fi

echo "Current version for $APP_NAME: $MAJOR.$MINOR.$PATCH"

case $BUMP_TYPE in
  major)
    MAJOR=$((MAJOR + 1))
    MINOR=0
    PATCH=0
    ;;
  minor)
    MINOR=$((MINOR + 1))
    PATCH=0
    ;;
  patch)
    PATCH=$((PATCH + 1))
    ;;
esac

NEW_VERSION="${APP_NAME}-v${MAJOR}.${MINOR}.${PATCH}"
echo "Bumping version to: $NEW_VERSION"

if [ -n "$GITHUB_OUTPUT" ]; then
  echo "version=$NEW_VERSION" >> $GITHUB_OUTPUT
fi
