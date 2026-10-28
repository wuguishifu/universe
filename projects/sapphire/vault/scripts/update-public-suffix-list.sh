#!/usr/bin/env bash
# Refreshes ios/Core/Resources/public_suffix_list.dat with the ICANN section of the public suffix
# list, minus comments. Bitwarden (via tldts) ignores the private section when matching base
# domains, so we do too.
set -euo pipefail

cd "$(dirname "$0")/.."
out=ios/Core/Resources/public_suffix_list.dat
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT

curl -sfL https://publicsuffix.org/list/public_suffix_list.dat -o "$tmp"
{
  echo "// ICANN section of https://publicsuffix.org/list/public_suffix_list.dat, fetched $(date +%F)."
  echo "// Mozilla Public License 2.0: https://mozilla.org/MPL/2.0/. Regenerate with scripts/update-public-suffix-list.sh."
  sed -n '/===BEGIN ICANN DOMAINS===/,/===END ICANN DOMAINS===/p' "$tmp" |
    grep -v '^//' | grep -v '^[[:space:]]*$' | sed 's/[[:space:]].*$//'
} >"$out"
echo "wrote $(wc -l <"$out" | tr -d ' ') lines to $out"
