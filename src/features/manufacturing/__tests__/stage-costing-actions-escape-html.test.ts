/**
 * Tests for escapeHtml(), added to sanitize the DB-sourced fields
 * (order number, item name, work-center name, status) interpolated into
 * the document.write print report in generateStageCostReport().
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../ui/events.js', () => ({
  default: { registerAction: vi.fn() },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/services/process-costing-service', () => ({
  processCostingService: {
    getStageCosts: vi.fn(),
    applyLaborTime: vi.fn(),
    applyOverhead: vi.fn(),
    upsertStageCost: vi.fn(),
  },
}));

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', async () => {
    const { escapeHtml } = await import('../stage-costing-actions.js');
    expect(escapeHtml(`<script>alert("x")</script> & 'quote'`)).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;quote&#39;'
    );
  });

  it('passes through Arabic and plain text unchanged', async () => {
    const { escapeHtml } = await import('../stage-costing-actions.js');
    expect(escapeHtml('أمر التصنيع رقم 123')).toBe('أمر التصنيع رقم 123');
  });

  it('treats null/undefined as an empty string', async () => {
    const { escapeHtml } = await import('../stage-costing-actions.js');
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  it('coerces numbers to their string form without throwing', async () => {
    const { escapeHtml } = await import('../stage-costing-actions.js');
    expect(escapeHtml(42.5)).toBe('42.5');
  });
});

describe('generateStageCostReport (XSS regression, real code path end to end)', () => {
  function fakeReportWindow() {
    const chunks: string[] = [];
    return {
      window: {
        document: {
          write: (html: string) => chunks.push(html),
          close: () => {},
        },
      },
      getHtml: () => chunks.join(''),
    };
  }

  it('escapes a malicious manufacturing order and stage costs before they reach document.write', async () => {
    const { generateStageCostReport } = await import('../stage-costing-actions.js');
    const { window: reportWindow, getHtml } = fakeReportWindow();
    const openWindow = vi.fn(() => reportWindow);
    const manufacturing = {
      getManufacturingOrderById: vi.fn(async () => ({
        success: true,
        data: {
          order_number: '<script>window.__pwned = true;</script>',
          item: { name: '<img src=x onerror=alert(1)>' },
          quantity: 10,
          status: '"><svg onload=alert(2)>',
        },
      })),
    };
    const stageCosts = [
      {
        stage_number: '<b>1</b>',
        work_center: { name: '<script>alert(3)</script>' },
        good_quantity: 5,
        total_cost: 100,
        unit_cost: 20,
        status: 'completed',
        updated_at: new Date().toISOString(),
      },
    ];

    await generateStageCostReport('mo-1', stageCosts, { manufacturing, openWindow });

    expect(openWindow).toHaveBeenCalledTimes(1);
    const html = getHtml();
    expect(html).not.toContain('<script>');

    // The real security property: none of the malicious fields survive as
    // live elements when the captured HTML is actually parsed by a DOM,
    // even though escapeHtml() (which only neutralizes & < > " ') leaves
    // inert text like the word "onerror=alert" visible as plain content.
    const div = document.createElement('div');
    div.innerHTML = html;
    expect(div.querySelector('script')).toBeNull();
    expect(div.querySelector('svg')).toBeNull();
    expect(div.querySelector('img[onerror]')).toBeNull();
    expect((globalThis as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
  });

  it('renders legitimate Arabic values unescaped-looking (round-trips through escapeHtml cleanly)', async () => {
    const { generateStageCostReport } = await import('../stage-costing-actions.js');
    const { window: reportWindow, getHtml } = fakeReportWindow();
    const openWindow = vi.fn(() => reportWindow);
    const manufacturing = {
      getManufacturingOrderById: vi.fn(async () => ({
        success: true,
        data: { order_number: 'MO-2026-001', item: { name: 'صنف تجريبي' }, quantity: 50, status: 'in_progress' },
      })),
    };
    const stageCosts = [
      {
        stage_number: 1,
        work_center: { name: 'مركز العمل الأول' },
        good_quantity: 45,
        total_cost: 500,
        unit_cost: 11.11,
        status: 'actual',
        updated_at: new Date().toISOString(),
      },
    ];

    await generateStageCostReport('mo-2', stageCosts, { manufacturing, openWindow });

    const html = getHtml();
    expect(html).toContain('MO-2026-001');
    expect(html).toContain('صنف تجريبي');
    expect(html).toContain('مركز العمل الأول');
  });

  it('does not throw and does not open a report window when the manufacturing order lookup returns no data (the pre-existing stub path)', async () => {
    const { generateStageCostReport } = await import('../stage-costing-actions.js');
    const openWindow = vi.fn();
    const manufacturing = { getManufacturingOrderById: vi.fn(async () => ({ success: true, data: null })) };

    await expect(generateStageCostReport('mo-3', [], { manufacturing, openWindow })).resolves.toBeUndefined();
    expect(openWindow).not.toHaveBeenCalled();
  });

  it('the real (non-injected) Manufacturing stub no longer throws "is not a function" — the pre-existing bug this branch fixes', async () => {
    const { generateStageCostReport } = await import('../stage-costing-actions.js');
    // No deps passed — exercises the module's own default Manufacturing
    // stub, whose method used to be named getManufacturingOrder() while
    // this function called getManufacturingOrderById(), throwing on every
    // "view stage report" click before it could reach the report window.
    await expect(generateStageCostReport('mo-4', [])).resolves.toBeUndefined();
  });
});
