import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { HrDashboardLayout } from '../layouts/HrDashboardLayout';
import '../i18n';
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

describe('HR localization', () => {
  beforeEach(async () => {
    await act(async () => {
      await i18n.changeLanguage('ar');
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('keeps Arabic and English HR resource keys in parity', () => {
    const ar = flatten(i18n.getResourceBundle('ar', 'hr'));
    const en = flatten(i18n.getResourceBundle('en', 'hr'));
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
    expect(Object.keys(ar).length).toBeGreaterThan(100);
  });

  it('updates legacy HR presentation text when language changes', async () => {
    render(
      <HrDashboardLayout>
        <section>
          <h1>إدارة الرواتب</h1>
          <input aria-label="بحث" placeholder="بحث بالاسم..." />
          <p>بيانات الموظف الفعلية: Ahmed Ali</p>
        </section>
      </HrDashboardLayout>,
    );

    expect(screen.getByText('إدارة الرواتب')).toBeInTheDocument();

    await act(async () => {
      await i18n.changeLanguage('en');
      await Promise.resolve();
    });

    expect(screen.getByText('Payroll Management')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search by name...')).toBeInTheDocument();
    expect(screen.getByText('بيانات الموظف الفعلية: Ahmed Ali')).toBeInTheDocument();
  });

  it('restores Arabic presentation text after switching back', async () => {
    render(<HrDashboardLayout><h1>إدارة الإجازات</h1></HrDashboardLayout>);
    await act(async () => { await i18n.changeLanguage('en'); await Promise.resolve(); });
    expect(screen.getByText('Leave Management')).toBeInTheDocument();
    await act(async () => { await i18n.changeLanguage('ar'); await Promise.resolve(); });
    expect(screen.getByText('إدارة الإجازات')).toBeInTheDocument();
  });
});
