#!/usr/bin/env bash
set -euo pipefail

expected="$(sha256sum package-lock.json | cut -d ' ' -f 1)"
marker="node_modules/.surfacetrace-lock-sha256"
installed="$(cat "$marker" 2>/dev/null || true)"

if [[ "$installed" != "$expected" ]]; then
  echo "SurfaceTrace dependency lock changed; refreshing container dependencies."
  npm ci
  printf '%s\n' "$expected" > "$marker"
fi

exec npm run dev:all
