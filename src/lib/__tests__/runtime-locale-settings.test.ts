import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyRuntimeLocaleSettings,
  formatRuntimeNumber,
  getDateLocale,
  getNumberLocale,
} from '@/lib/runtime-locale-settings';

describe('organization runtime locale settings', () => {
  beforeEach(() => {
    applyRuntimeLocaleSettings({
      currency: 'SAR',
      numberFormat: 'en-US',
      dateFormat: 'en-US',
    });
  });

  it('configures Latin digits for en-US', () => {
    applyRuntimeLocaleSettings({ numberFormat: 'en-US' });

    expect(getNumberLocale()).toBe('en-US-u-nu-latn');
    expect(formatRuntimeNumber(1234.56)).not.toMatch(/[٠-٩]/);
  });

  it('configures Arabic-Indic digits for ar-SA', () => {
    applyRuntimeLocaleSettings({ numberFormat: 'ar-SA' });

    expect(getNumberLocale()).toBe('ar-SA-u-nu-arab');
    expect(formatRuntimeNumber(1234.56)).toMatch(/[٠-٩]/);
  });

  it('combines Umm al-Qura calendar with independently selected Latin digits', () => {
    applyRuntimeLocaleSettings({ numberFormat: 'en-US', dateFormat: 'ar-SA' });

    expect(getDateLocale()).toBe('ar-SA-u-ca-islamic-umalqura-nu-latn');
  });

  it('combines Gregorian calendar with Latin digits', () => {
    applyRuntimeLocaleSettings({ numberFormat: 'en-US', dateFormat: 'en-US' });

    expect(getDateLocale()).toBe('en-US-u-ca-gregory-nu-latn');
  });
});
