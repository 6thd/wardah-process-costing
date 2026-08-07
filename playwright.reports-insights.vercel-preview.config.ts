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
// Both env vars fail the config load immediately rather than silently
// running unauthenticated (which would just 401 against every request with
// no clear signal why) or against the wrong target — this is a check
// against the real deployment, not something that should degrade quietly.
//
// See .github/workflows/reports-insights-isolation-e2e.yml's
// vercel-preview-check job (pull_request-triggered, so it can run from
// this PR's own branch before merge — a workflow_dispatch job cannot be
// dispatched until its file exists on the default branch) and
// .github/workflows/reports-insights-vercel-preview-check.yml (the
// permanent, manually-triggered version for post-merge use).
if (!process.env.PLAYWRIGHT_VERCEL_PREVIEW_URL) {
  throw new Error(
    'playwright.reports-insights.vercel-preview.config.ts requires PLAYWRIGHT_VERCEL_PREVIEW_URL to be set — ' +
      'use playwright.reports-insights.config.ts instead for the local-server run.'
  );
}
if (!process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
  throw new Error(
    'playwright.reports-insights.vercel-preview.config.ts requires VERCEL_AUTOMATION_BYPASS_SECRET to be set — ' +
      'create a "Protection Bypass for Automation" secret in the Vercel project\'s Deployment Protection settings ' +
      'and pass it here, rather than running unauthenticated against a protected Preview.'
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
    // x-vercel-set-bypass-cookie asks Vercel to also set the bypass as a
    // SameSite=None cookie (per Vercel's own documented Playwright setup)
    // so the sandboxed dashboard's iframe navigation — a same-page but,
    // due to its opaque sandboxed origin, third-party-cookie-context
    // request — stays authenticated past the first request too, not just
    // the top-level page load. x-vercel-skip-toolbar is Vercel's own
    // documented mechanism for automated E2E tests specifically — it
    // disables the Vercel Toolbar/live-feedback script injection for
    // requests carrying it, without touching CSP or requiring a
    // dashboard-side project/branch setting.
    extraHTTPHeaders: {
      'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
      'x-vercel-set-bypass-cookie': 'samesitenone',
      'x-vercel-skip-toolbar': '1',
    },
  },
});
