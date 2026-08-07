/**
 * Regression + isolation suite for the sandboxed AI Insights dashboard
 * (public/reports-insights/dashboard.html).
 *
 * This does NOT need a Supabase session or the E2E_* account env vars the
 * rest of the suite requires — dashboard.html never talks to Supabase or
 * holds any credential itself; that boundary is exactly what this suite
 * proves. It stands up its own static server (local-vercel-headers-server)
 * that reproduces vercel.json's real response headers, instead of using
 * the Vite dev server the rest of the suite points at, since the dev
 * server does not send production headers at all.
 */
import { test, expect, type Page } from '@playwright/test';
import type { Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startLocalVercelHeadersServer } from './fixtures/local-vercel-headers-server';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4174;
const ORIGIN = `http://localhost:${PORT}`;

let server: Server;

test.beforeAll(async () => {
  server = await startLocalVercelHeadersServer(PORT);
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function gotoHarness(page: Page) {
  const harnessHtml = await readFile(path.join(__dirname, 'fixtures/reports-insights-harness.html'), 'utf8');
  await page.route(`${ORIGIN}/__harness__`, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: harnessHtml })
  );
  await page.goto(`${ORIGIN}/__harness__`);
}

test.describe('reports-insights response headers (vercel.json)', () => {
  test('the isolated dashboard route sends an enforcing CSP — script-src stays strict, style-src allows unsafe-inline only (ApexCharts compatibility), X-Frame-Options: SAMEORIGIN', async ({ request }) => {
    const res = await request.get(`${ORIGIN}/reports-insights/dashboard.html`);
    expect(res.status()).toBe(200);

    const csp = res.headers()['content-security-policy'];
    expect(csp, 'dashboard.html must send an enforcing CSP, not just Report-Only').toBeTruthy();

    // script-src: still strict. No eval, no inline script, of any kind —
    // this is the directive that actually matters for arbitrary code
    // execution, and it is not weakened by the style-src decision below.
    const scriptSrcDirective = csp!.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src'));
    expect(scriptSrcDirective, 'script-src directive must be present').toBeTruthy();
    expect(scriptSrcDirective).toBe("script-src 'self'");
    expect(scriptSrcDirective).not.toContain('unsafe-eval');
    expect(scriptSrcDirective).not.toContain('unsafe-inline');

    // style-src: deliberately relaxed to allow 'unsafe-inline', scoped to
    // this one directive only — ApexCharts 5.3.6 writes some of its
    // internal SVG sub-element styling via a whole-attribute style write
    // (`setAttribute('style', ...)`/`.style.cssText = ...`), which CSP's
    // style-src governs the same as a literal style="..." attribute.
    // Approved decision: accept this narrow, style-only relaxation inside
    // an iframe with no allow-same-origin rather than patch a
    // third-party charting library or accept broken chart rendering.
    const styleSrcDirective = csp!.split(';').map((d) => d.trim()).find((d) => d.startsWith('style-src'));
    expect(styleSrcDirective, 'style-src directive must be present').toBeTruthy();
    expect(styleSrcDirective).toBe("style-src 'self' 'unsafe-inline'");

    expect(csp).toContain("frame-ancestors 'self'");
    expect(res.headers()['x-frame-options']).toBe('SAMEORIGIN');
  });

  test('every other route keeps X-Frame-Options: DENY and no conflicting header is ever sent for the same path', async ({ request }) => {
    const res = await request.get(`${ORIGIN}/reports-insights/../index.html`.replace('/reports-insights/../', '/'));
    expect(res.headers()['x-frame-options']).toBe('DENY');
    // The two vercel.json source patterns are constructed to be mutually
    // exclusive (negative lookahead), so a single request can only ever
    // match one rule — this asserts there is exactly one X-Frame-Options
    // value in play for any given path, never both DENY and SAMEORIGIN.
    expect(res.headers()['x-frame-options']).not.toBe('SAMEORIGIN');
  });
});

test.describe('CSP compliance under the isolated route real headers', () => {
  test('ApexCharts renders under the route CSP (script-src \'self\' strict; style-src allows unsafe-inline) with zero CSP violation reports', async ({ page }) => {
    const consoleErrors: string[] = [];
    const cspViolations: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    // A CSP-blocked eval()/new Function() call throws a real, catchable
    // SecurityError/EvalError inside the sandboxed frame's own script —
    // Chromium also surfaces it as a page console error even across the
    // frame boundary, which the page.on('console')/'pageerror' listeners
    // above capture. This is the concrete way to answer "does ApexCharts
    // need eval under this CSP" for real, in a real browser, rather than
    // by static analysis of the minified bundle.
    await gotoHarness(page);
    await page.evaluate(() => (window as any).__harness.loadTarget());

    const frame = page.frameLocator('#target');
    await expect(frame.locator('#loadingOverlay')).toHaveCSS('display', 'none', { timeout: 15000 });

    const childFrame = page.frames().find((f) => f.url().includes('/reports-insights/dashboard.html'));
    expect(childFrame).toBeTruthy();
    // ApexCharts instantiates three charts during render() (advanced3D,
    // predictive, advancedBreakdown), which happens slightly after the
    // loading overlay itself is hidden (startAdvancedAnimations() etc.
    // still run afterward) — assert their containers actually received
    // rendered content (an <svg> or <canvas> from ApexCharts' own
    // rendering, not just an empty div), which could only happen if
    // ApexCharts executed successfully end-to-end under this CSP.
    await expect
      .poll(
        async () =>
          childFrame!.evaluate(() => {
            const ids = ['advanced3DChart', 'predictiveChart', 'advancedBreakdownChart'];
            return ids.some((id) => {
              const el = document.getElementById(id);
              return !!el && (el.querySelector('svg') !== null || el.querySelector('canvas') !== null);
            });
          }),
        { timeout: 20000 }
      )
      .toBe(true);

    cspViolations.push(...consoleErrors.filter((e) => /content security policy|refused to/i.test(e)));

    // Previously (script-src 'self'; style-src 'self' with NO
    // unsafe-inline) this reliably produced 7 "Refused to apply inline
    // style" violations from ApexCharts' whole-attribute style writes
    // (setAttribute('style', ...)/.style.cssText = ...) — a real,
    // browser-verified CSP incompatibility, not a false positive.
    // Approved fix: style-src now includes 'unsafe-inline' for this
    // route only (script-src is untouched and stays strict). This
    // assertion is intentionally a hard zero, not a filtered allowlist —
    // if ApexCharts (or anything else on this route) produces ANY CSP
    // violation again, this must fail, since the whole point of the
    // style-src relaxation was to make the violation set genuinely empty.
    expect(cspViolations, `CSP violations detected (expected zero after the style-src fix): ${cspViolations.join('\n')}`).toEqual([]);
  });
});

test.describe('sandboxed iframe isolation', () => {
  test('loads with zero third-party/CDN network requests', async ({ page }) => {
    const externalRequests: string[] = [];
    page.on('request', (req) => {
      const url = new URL(req.url());
      if (url.origin !== ORIGIN && url.protocol !== 'data:' && url.protocol !== 'about:') {
        externalRequests.push(req.url());
      }
    });

    await gotoHarness(page);
    await page.evaluate(() => (window as any).__harness.loadTarget());
    const frame = page.frameLocator('#target');
    await expect(frame.locator('#loadingOverlay')).toHaveCSS('display', 'none', { timeout: 15000 });

    expect(externalRequests, `Unexpected external requests: ${externalRequests.join(', ')}`).toEqual([]);
  });

  test('the iframe cannot read the parent document or the parent-scoped secret in localStorage', async ({ page }) => {
    await gotoHarness(page);
    await page.evaluate(() => (window as any).__harness.loadTarget());
    await page.frameLocator('#target').locator('#loadingOverlay').waitFor({ state: 'hidden', timeout: 15000 });

    const childFrame = page.frames().find((f) => f.url().includes('/reports-insights/dashboard.html'));
    expect(childFrame).toBeTruthy();

    const parentDomAccess = await childFrame!.evaluate(() => {
      try {
        // Opaque origin (no allow-same-origin): reading a cross-origin
        // window's .document must throw, even though it's same-host.
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        (window.parent as any).document;
        return 'accessible';
      } catch (e) {
        return `blocked:${(e as Error).name}`;
      }
    });
    expect(parentDomAccess.startsWith('blocked:')).toBe(true);

    const localStorageLeak = await childFrame!.evaluate(() => {
      try {
        return window.localStorage.getItem('parent-secret');
      } catch (e) {
        return `blocked:${(e as Error).name}`;
      }
    });
    expect(localStorageLeak).not.toBe('TOP-SECRET-PARENT-VALUE');
  });

  test('rejects a forged WARDHAH_INSIGHT_RESPONSE from a sender that is not window.parent', async ({ page }) => {
    await gotoHarness(page);
    await page.evaluate(() => (window as any).__harness.loadTarget());
    await page.frameLocator('#target').locator('#loadingOverlay').waitFor({ state: 'hidden', timeout: 15000 });

    await page.evaluate(() => (window as any).__harness.forgeFromDecoy('forged-request-id'));
    await page.waitForTimeout(1000);

    const chatText = await page.frameLocator('#target').locator('#aiChat').innerText();
    expect(chatText).not.toContain('INJECTED-BY-DECOY-NOT-REAL-PARENT');
  });
});

test.describe('feature parity through the new postMessage contract', () => {
  test('WARDHAH_DATA_SYNC updates the rendered KPIs after REQUEST_WARDHAH_DATA', async ({ page }) => {
    await gotoHarness(page);
    await page.evaluate(() => (window as any).__harness.loadTarget());
    const frame = page.frameLocator('#target');
    await expect(frame.locator('#loadingOverlay')).toHaveCSS('display', 'none', { timeout: 15000 });

    await expect
      .poll(async () => page.evaluate(() => (window as any).__harness.receivedFromIframe.some((m: any) => m.type === 'REQUEST_WARDHAH_DATA')), { timeout: 15000 })
      .toBe(true);

    await expect(frame.locator('#advancedKpiContainer')).not.toBeEmpty({ timeout: 15000 });
  });

  test('a chat question round-trips through WARDHAH_INSIGHT_REQUEST/RESPONSE and renders the AI answer', async ({ page }) => {
    await gotoHarness(page);
    await page.evaluate(() => (window as any).__harness.loadTarget());
    const frame = page.frameLocator('#target');
    await expect(frame.locator('#loadingOverlay')).toHaveCSS('display', 'none', { timeout: 15000 });

    await frame.locator('#aiAssistantBtn').click();
    await frame.locator('.quick-question').first().click();

    await expect(frame.locator('#aiChat')).toContainText('harness-provided-insight-text-ask', { timeout: 15000 });
  });

  test('falls back to a local deterministic answer if the parent never responds (provider/timeout degradation)', async ({ page }) => {
    // Two sequential ~15s internal requestInsight() fallback waits
    // (initial insights during init(), then the chat question) exceed
    // Playwright's default 30s per-test timeout.
    test.setTimeout(60000);
    await gotoHarness(page);
    await page.evaluate(() => {
      (window as any).__harness.respondMode = 'timeout';
      (window as any).__harness.loadTarget();
    });
    const frame = page.frameLocator('#target');
    // generateInitialInsights() during init() also calls requestInsight(),
    // so with respondMode 'timeout' the loading overlay itself only hides
    // after that call's own ~15s internal fallback resolves — give this
    // one more headroom than the other tests' loadingOverlay wait.
    await expect(frame.locator('#loadingOverlay')).toHaveCSS('display', 'none', { timeout: 25000 });

    await frame.locator('#aiAssistantBtn').click();
    await frame.locator('.quick-question').first().click();

    // The iframe's requestInsight() resolves to buildLocalInsight() after
    // its own 15s timeout when no WARDHAH_INSIGHT_RESPONSE ever arrives —
    // the dashboard must never appear to hang or error out just because
    // the host page (or the real Edge Function behind it) is unavailable.
    await expect(frame.locator('#aiChat .ai-message').last()).not.toBeEmpty({ timeout: 20000 });
    const chatText = await frame.locator('#aiChat').innerText();
    expect(chatText).not.toContain('harness-provided-insight-text-ask');
  });
});
