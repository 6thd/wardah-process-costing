import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { useHrTranslation } from '../i18n';
import '../translations/pages';
import '../translations/reports';

function flatten(value: unknown, prefix = '', target: Record<string, string> = {}) {
  if (!value || typeof value !== 'object') return target;
  Object.entries(value as Record<string, unknown>).forEach(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof child === 'string') target[path] = child;
    else flatten(child, path, target);
  });
  return target;
}

function TranslationProbe() {
  const { t } = useHrTranslation();
  return <section><h1>{t('payroll.title')}</h1><input aria-label={t('common.search')} placeholder={t('leaves.searchPlaceholder')} /><p>{t('settlements.reviewWarning')}</p></section>;
}

describe('HR localization', () => {
  beforeEach(async () => {
    await act(async () => { await i18n.changeLanguage('ar'); });
  });
  afterEach(cleanup);

  it('keeps Arabic and English HR resource keys in parity', () => {
    const ar = flatten(i18n.getResourceBundle('ar', 'hr'));
    const en = flatten(i18n.getResourceBundle('en', 'hr'));
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
    expect(Object.keys(ar).length).toBeGreaterThan(100);
  });

  it('updates direct HR translations when language changes', async () => {
    render(<TranslationProbe />);
    expect(screen.getByText('إدارة الرواتب')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('بحث بالاسم...')).toBeInTheDocument();

    await act(async () => { await i18n.changeLanguage('en'); });

    expect(screen.getByText('Payroll Management')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search by name...')).toBeInTheDocument();
    expect(screen.getByText(/Approval creates the accounting entry/)).toBeInTheDocument();
  });

  it('restores Arabic translations after switching back', async () => {
    render(<TranslationProbe />);
    await act(async () => { await i18n.changeLanguage('en'); });
    await act(async () => { await i18n.changeLanguage('ar'); });
    expect(screen.getByText('إدارة الرواتب')).toBeInTheDocument();
  });
});
