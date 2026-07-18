import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyRuntimeLocaleSettings,
  formatRuntimeDate,
  formatRuntimeNumber,
} from '@/lib/runtime-locale-settings';

describe('organization runtime locale settings', () => {
  beforeEach(() => {
    window.localStorage.clear();
    applyRuntimeLocaleSettings({ currency: 'SAR', numberFormat: 'en-US', dateFormat: 'en-US' });
  });

  it('uses Latin digits when en-US number format is selected', () => {
    applyRuntimeLocaleSettings({ numberFormat: 'en-US' });
    expect(formatRuntimeNumber(1234.56)).toMatch(/1/);
    expect(formatRuntimeNumber(1234.56)).not.toMatch(/[٠-٩]/);
  });

  it('uses Arabic-Indic digits when ar-SA number format is selected', () => {
    applyRuntimeLocaleSettings({ numberFormat: 'ar-SA' });
    expect(formatRuntimeNumber(1234.56)).toMatch(/[٠-٩]/);
  });

  it('keeps Latin digits with the Hijri calendar when requested', () => {
    applyRuntimeLocaleSettings({ numberFormat: 'en-US', dateFormat: 'ar-SA' });
    const output = formatRuntimeDate(new Date('2026-07-18T00:00:00Z'), {
      year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'UTC',
    });
    expect(output).not.toMatch(/[٠-٩]/);
    expect(output).not.toContain('2026');
  });

  it('uses the Gregorian calendar independently from UI language', () => {
    applyRuntimeLocaleSettings({ numberFormat: 'en-US', dateFormat: 'en-US' });
    const output = formatRuntimeDate(new Date('2026-07-18T00:00:00Z'), {
      year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'UTC',
    });
    expect(output).toContain('2026');
  });
});
