import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyRuntimeLocaleSettings,
  formatRuntimeNumber,
  getDateLocale,
  getNumberLocale,
} from '@/lib/runtime-locale-settings';

describe('organization runtime locale settings', () => {
  beforeEach(() => {
    window.localStorage.clear();
    applyRuntimeLocaleSettings({
      currency: 'SAR',
      numberFormat: 'en-US',
      dateFormat: 'en-US',
    });
  });

  it('uses Latin digits when en-US number format is selected', () => {
    applyRuntimeLocaleSettings({ numberFormat: 'en-US' });
    const formatter = new Intl.NumberFormat(getNumberLocale());

    expect(formatter.resolvedOptions().numberingSystem).toBe('latn');
    expect(formatRuntimeNumber(1234.56)).not.toMatch(/[٠-٩]/);
  });

  it('uses Arabic-Indic digits when ar-SA number format is selected', () => {
    applyRuntimeLocaleSettings({ numberFormat: 'ar-SA' });
    const formatter = new Intl.NumberFormat(getNumberLocale());

    expect(formatter.resolvedOptions().numberingSystem).toBe('arab');
    expect(formatRuntimeNumber(1234.56)).toMatch(/[٠-٩]/);
  });

  it('selects Umm al-Qura independently from the digit system', () => {
    applyRuntimeLocaleSettings({ numberFormat: 'en-US', dateFormat: 'ar-SA' });
    const formatter = new Intl.DateTimeFormat(getDateLocale());
    const resolved = formatter.resolvedOptions();

    expect(resolved.calendar).toBe('islamic-umalqura');
    expect(resolved.numberingSystem).toBe('latn');
  });

  it('selects Gregorian calendar with Latin digits', () => {
    applyRuntimeLocaleSettings({ numberFormat: 'en-US', dateFormat: 'en-US' });
    const formatter = new Intl.DateTimeFormat(getDateLocale());
    const resolved = formatter.resolvedOptions();

    expect(resolved.calendar).toBe('gregory');
    expect(resolved.numberingSystem).toBe('latn');
  });
});
