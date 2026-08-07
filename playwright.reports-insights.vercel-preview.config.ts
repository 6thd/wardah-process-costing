import { defineConfig } from '@playwright/test';
import base from './playwright.reports-insights.config';

// Runs e2e/reports-insights-isolation.spec.ts against a REAL Vercel Preview
// deployment instead of the local header-reproducing server — see that
// spec file's own comment on PLAYWRIGHT_VERCEL_PREVIEW_URL for how ORIGIN
// switches. This is what actually proves vercel.json's CSP/X-Frame-Options/
// CORS headers, the zero-CDN-request guarantee, and the "no sample data"
// behavior hold on Vercel itself, not only in the local reproduction the
// pull_request-gated run uses.
//
// Required env vars (never hardcoded or logged):
//   PLAYWRIGHT_VERCEL_PREVIEW_URL      — e.g. https://<preview>.vercel.app
//   VERCEL_AUTOMATION_BYPASS_SECRET    — Vercel's "Protection Bypass for
//     Automation" secret (Project Settings -> Deployment Protection). This
//     is a distinct mechanism from a temporary share link: it is a
//     persistent-until-rotated secret sent as the x-vercel-protection-bypass
//     request header, scoped to requests carrying it — it does not disable
//     SSO/password protection for the project. Create it, run this suite,
//     then rotate/revoke it from the same Vercel settings page; do not
//     leave a long-lived bypass secret active longer than the check needs.
//
// See .github/workflows/reports-insights-vercel-preview-check.yml for the
// workflow_dispatch job that wires these in as inputs/secrets.
if (!process.env.PLAYWRIGHT_VERCEL_PREVIEW_URL) {
  throw new Error(
    'playwright.reports-insights.vercel-preview.config.ts requires PLAYWRIGHT_VERCEL_PREVIEW_URL to be set — ' +
      'use playwright.reports-insights.config.ts instead for the local-server run.'
  );
}

export default defineConfig({
  ...base,
  use: {
    ...base.use,
    // Applies to both the `page` browser context and the `request` API
    // fixture (Playwright seeds both from `use`), so every request this
    // suite makes — navigation, iframe subresources, and direct
    // request.get() header/CSP checks alike — carries the bypass header.
    extraHTTPHeaders: process.env.VERCEL_AUTOMATION_BYPASS_SECRET
      ? { 'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET }
      : undefined,
  },
});
