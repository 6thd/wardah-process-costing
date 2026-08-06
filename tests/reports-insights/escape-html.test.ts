/**
 * XSS regression test for provider output (Migration 171 / reports-insights
 * architecture correction #8): the reports-insights Edge Function's model
 * output is untrusted by construction — a malicious or compromised provider
 * response must never execute as markup when rendered into the dashboard's
 * chat/insight panels. `escapeHtml()` is the sole sanitization boundary
 * before any AI-generated or user-typed text is interpolated into an
 * innerHTML template literal in public/reports-insights/dashboard.html.
 *
 * This imports the actual runtime file the dashboard loads via
 * `<script src="./escape-html.js">`, not a reimplementation, so the test
 * exercises the real code path.
 */
import { describe, it, expect } from 'vitest';

async function loadEscapeHtml() {
  const mod: any = await import('../../public/reports-insights/escape-html.js');
  return mod.escapeHtml as (value: unknown) => string;
}

describe('reports-insights escapeHtml (provider output sanitization)', () => {
  it('neutralizes a raw <script> tag from a malicious provider response', async () => {
    const escapeHtml = await loadEscapeHtml();
    const malicious = '<script>window.__pwned = true;</script>';
    const escaped = escapeHtml(malicious);

    expect(escaped).not.toContain('<script>');
    expect(escaped).toBe('&lt;script&gt;window.__pwned = true;&lt;/script&gt;');

    const div = document.createElement('div');
    div.innerHTML = escaped;
    expect(div.querySelector('script')).toBeNull();
  });

  it('neutralizes an event-handler-bearing tag (img onerror)', async () => {
    const escapeHtml = await loadEscapeHtml();
    const malicious = '<img src=x onerror="window.__pwned = true">';
    const escaped = escapeHtml(malicious);

    const div = document.createElement('div');
    div.innerHTML = escaped;
    expect(div.querySelector('img')).toBeNull();
    expect((globalThis as any).__pwned).toBeUndefined();
  });

  it('neutralizes a markdown-adjacent payload combining link and script injection', async () => {
    const escapeHtml = await loadEscapeHtml();
    const malicious = '[click me](javascript:alert(1))<svg onload=alert(2)>';
    const escaped = escapeHtml(malicious);

    const div = document.createElement('div');
    div.innerHTML = escaped;
    expect(div.querySelector('svg')).toBeNull();
    expect(div.textContent).toBe(malicious);
  });

  it('passes through plain AI-generated Arabic/English insight text unchanged', async () => {
    const escapeHtml = await loadEscapeHtml();
    expect(escapeHtml('الأرباح ارتفعت بنسبة 12% هذا الشهر')).toBe(
      'الأرباح ارتفعت بنسبة 12% هذا الشهر'
    );
    expect(escapeHtml('Profit is up 12% this month')).toBe('Profit is up 12% this month');
  });

  it('treats null/undefined provider output as an empty string rather than throwing', async () => {
    const escapeHtml = await loadEscapeHtml();
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});
