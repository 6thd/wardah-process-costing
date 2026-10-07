#!/usr/bin/env bash
# Test fixture has no live Supabase client. The Vite server and browser must run
# in this same process tree on executors that isolate network namespaces.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"
: "${WARDAH_BROWSER_EXECUTABLE:?Point to an installed Chromium executable}"
# Evidence paths are fixed and shared with verify.mjs; no environment value
# controls filesystem writes. Copy the output after the run if needed.
mkdir -p /tmp/wardah-issue-browser
npm exec vite -- --config tests/fixtures/material-issue-browser/vite.config.ts > /tmp/wardah-issue-browser/vite.log 2>&1 &
ISSUE_VITE_PID=$!
trap 'kill "$ISSUE_VITE_PID" 2>/dev/null || true' EXIT
for ((attempt=0; attempt<60; attempt++)); do if curl --fail --silent http://127.0.0.1:4175/ >/dev/null; then break; fi; sleep 0.25; done
timeout --kill-after=5 100 node tests/fixtures/material-issue-browser/verify.mjs
timeout --kill-after=5 100 node tests/fixtures/material-issue-browser/verify-maintenance.mjs
