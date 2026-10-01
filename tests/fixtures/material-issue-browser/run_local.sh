#!/usr/bin/env bash
# Test fixture has no live Supabase client. The Vite server and browser must run
# in this same process tree on executors that isolate network namespaces.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"
: "${WARDAH_BROWSER_EXECUTABLE:?Point to an installed Chromium executable}"
: "${WARDAH_BROWSER_OUTPUT:?Select a local output directory}"
mkdir -p "$WARDAH_BROWSER_OUTPUT"
npm exec vite -- --config tests/fixtures/material-issue-browser/vite.config.ts > "$WARDAH_BROWSER_OUTPUT/vite.log" 2>&1 &
ISSUE_VITE_PID=$!
trap 'kill "$ISSUE_VITE_PID" 2>/dev/null || true' EXIT
for i in $(seq 1 60); do if curl --fail --silent http://127.0.0.1:4175/ >/dev/null; then break; fi; sleep 0.25; done
timeout --kill-after=5 100 node tests/fixtures/material-issue-browser/verify.mjs
