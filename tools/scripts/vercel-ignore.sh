#!/usr/bin/env bash
# Vercel "Ignored Build Step" for Nx projects.
#
#   Usage (Vercel project settings → Git → Ignored Build Step):
#     bash tools/scripts/vercel-ignore.sh <nx-project>
#
# Exit codes follow Vercel's convention: 0 = skip the build, 1 = build.
# Any unexpected failure builds, so problems surface in the real build log.
#
# Replaces `npx nx-ignore`, which runs `pnpm install --force` with whatever pnpm is on the
# build image (ignoring our pinned version and `nodeLinker: hoisted`), then deletes only the
# root node_modules. That left stale per-package `.bin` shims pointing at a non-existent
# `node_modules/.pnpm/...` layout and broke later `tsc` runs.
set -uo pipefail

project="${1:-}"
if [[ -z "$project" ]]; then
  echo "≫ No project passed to vercel-ignore.sh"
  exit 1
fi

build() { echo "✅ - $1"; exit 1; }
skip() { echo "🛑 - $1"; exit 0; }

commit_message="$(git log -1 --pretty=%B)"
case "$commit_message" in
  *"[nx deploy]"* | *"[nx deploy $project]"*) build "Forced build due to commit message" ;;
  *"[skip ci]"* | *"[ci skip]"* | *"[nx skip]"* | *"[nx skip $project]"*) skip "Skipped due to commit message" ;;
esac

# Compare against the last deployed commit when Vercel gives us one we actually have
# (clones are shallow), otherwise fall back to the parent commit.
base="${VERCEL_GIT_PREVIOUS_SHA:-}"
if [[ -z "$base" ]] || ! git cat-file -e "${base}^{commit}" 2>/dev/null; then
  base="HEAD^"
fi
if ! git cat-file -e "${base}^{commit}" 2>/dev/null; then
  build "No base commit available to compare against"
fi

# Use the exact pnpm version from package.json#packageManager so the install matches the real one
# (same linker, same lockfile handling). The install step that follows is then close to a no-op.
pnpm_version="$(node -p "require('./package.json').packageManager.split('@')[1].split('+')[0]")" \
  || build "Could not read pnpm version from package.json"
pnpm=(npx --yes "pnpm@${pnpm_version}")

echo "≫ Installing dependencies with pnpm@${pnpm_version}..."
"${pnpm[@]}" install --frozen-lockfile >/dev/null || build "Dependency install failed"

echo "≫ Checking whether $project is affected ($base...HEAD)..."
affected="$(NX_DAEMON=false "${pnpm[@]}" nx show projects --affected --json --base="$base" --head=HEAD | tail -n 1)" \
  || build "Could not compute affected projects"

if node -e 'process.exit(JSON.parse(process.argv[1]).includes(process.argv[2]) ? 0 : 1)' "$affected" "$project"; then
  build "Build can proceed since $project is affected"
else
  skip "Build cancelled since $project is not affected"
fi
