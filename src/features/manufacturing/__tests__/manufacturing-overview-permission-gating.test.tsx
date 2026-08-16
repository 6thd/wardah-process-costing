// src/features/manufacturing/__tests__/manufacturing-overview-permission-gating.test.tsx
//
// ManufacturingOverview كان يستدعي useManufacturingOrders() دائمًا لأي
// مستخدم اجتاز anyOf مستوى المسار. هذه الاختبارات تثبت أن الاستعلام لا
// يُطلَق بلا manufacturing.orders.read، وأن كل بطاقة مربوطة بمفتاحها.

import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hasPermissionKeyMock = vi.fn((_key: string) => false);

vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasPermissionKey: (key: string) => hasPermissionKeyMock(key),
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'ar' } }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

const manufacturingGetAll = vi.fn().mockResolvedValue([]);

vi.mock('@/services/supabase-service', () => ({
  manufacturingService: { getAll: (...args: unknown[]) => manufacturingGetAll(...args) },
}));

import { ManufacturingOverview } from '../ManufacturingOverview';

function setPermissions(keys: readonly string[]) {
  hasPermissionKeyMock.mockImplementation((key: string) => keys.includes(key));
}

function renderOverview() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ManufacturingOverview />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  hasPermissionKeyMock.mockReturnValue(false);
});

describe('ManufacturingOverview — per-section permission-aware loading', () => {
  it('manufacturing.orders.read alone fetches orders and shows only orders-derived sections', async () => {
    setPermissions(['manufacturing.orders.read']);
    renderOverview();

    await waitFor(() => expect(manufacturingGetAll).toHaveBeenCalled());
    expect(screen.getByText('manufacturing.overviewPage.metrics.active')).toBeInTheDocument();
    expect(screen.queryByText('manufacturing.overviewPage.cards.bom.title')).not.toBeInTheDocument();
  });

  it('manufacturing.boms.read alone never fetches orders and hides orders-derived sections', async () => {
    setPermissions(['manufacturing.boms.read']);
    renderOverview();

    await waitFor(() => expect(screen.getByText('manufacturing.overviewPage.cards.bom.title')).toBeInTheDocument());
    expect(manufacturingGetAll).not.toHaveBeenCalled();
    expect(screen.queryByText('manufacturing.overviewPage.metrics.active')).not.toBeInTheDocument();
    expect(screen.queryByText('manufacturing.overviewPage.cards.orders.title')).not.toBeInTheDocument();
  });

  it('manufacturing.work_centers.read alone shows only the work-centers card', async () => {
    setPermissions(['manufacturing.work_centers.read']);
    renderOverview();

    await waitFor(() => expect(screen.getByText('manufacturing.overviewPage.cards.workCenters.title')).toBeInTheDocument());
    expect(manufacturingGetAll).not.toHaveBeenCalled();
    expect(screen.queryByText('manufacturing.overviewPage.cards.bom.title')).not.toBeInTheDocument();
    expect(screen.queryByText('manufacturing.overviewPage.cards.orders.title')).not.toBeInTheDocument();
  });

  it('manufacturing.stages.read alone shows the stages card — a stages-only user is not left with an empty grid', async () => {
    // خلل جولة سابقة: manufacturing.stages.read جزء من anyOf دخول الشاشة عبر
    // ModuleGuard لكن لا بطاقة له، فيدخل مستخدم يملكه وحده ولا يرى شيئًا ذا صلة.
    setPermissions(['manufacturing.stages.read']);
    renderOverview();

    await waitFor(() => expect(screen.getByText('manufacturing.overviewPage.cards.stages.title')).toBeInTheDocument());
    expect(manufacturingGetAll).not.toHaveBeenCalled();
    expect(screen.queryByText('manufacturing.overviewPage.cards.bom.title')).not.toBeInTheDocument();
    expect(screen.queryByText('manufacturing.overviewPage.cards.orders.title')).not.toBeInTheDocument();
  });

  it('preserves every permitted card destination after card decomposition', async () => {
    setPermissions([
      'manufacturing.orders.read',
      'manufacturing.boms.read',
      'manufacturing.work_centers.read',
      'manufacturing.stage_costs.read',
      'manufacturing.stages.read',
    ]);
    renderOverview();
    await waitFor(() => expect(manufacturingGetAll).toHaveBeenCalled());

    const destinations = [
      ['manufacturing.overviewPage.cards.orders.title', '/manufacturing/orders'],
      ['manufacturing.overviewPage.cards.processCosting.title', '/manufacturing/process-costing'],
      ['manufacturing.overviewPage.cards.workCenters.title', '/manufacturing/workcenters'],
      ['manufacturing.overviewPage.cards.bom.title', '/manufacturing/bom'],
      ['manufacturing.overviewPage.cards.stages.title', '/manufacturing/stages'],
      ['manufacturing.overviewPage.cards.quality.title', '/manufacturing/quality'],
    ] as const;

    for (const [name, href] of destinations) {
      expect(screen.getByRole('link', { name: new RegExp(name.replaceAll('.', '\\.')) }))
        .toHaveAttribute('href', href);
    }
    expect(screen.getByText('manufacturing.overviewPage.cards.labor.title')).toBeInTheDocument();
  });
});
