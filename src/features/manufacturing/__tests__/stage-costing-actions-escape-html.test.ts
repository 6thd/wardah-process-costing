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
