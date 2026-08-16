import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// e2e/reports-insights-isolation.spec.ts needs no baseURL/dev server at
// all — it starts its own local-vercel-headers-server (see
// e2e/fixtures/local-vercel-headers-server.ts) so it can assert on
// vercel.json's real response headers, which the Vite dev server never
// sends. The default playwright.config.ts always starts `npm run dev` as
// a webServer for the rest of the suite; reusing it here would be a
// slow, unnecessary dependency this suite doesn't have, and in CI
// (reuseExistingServer: false) a real failure to start it would fail
// this job for a reason unrelated to what it's actually testing.
export default defineConfig({
  ...base,
  webServer: undefined,
});
