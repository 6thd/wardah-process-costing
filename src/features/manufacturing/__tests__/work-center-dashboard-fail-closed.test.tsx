// src/features/manufacturing/__tests__/work-center-dashboard-fail-closed.test.tsx
//
// WorkCenterDashboard (MES) previously ran useStartOperation/useCompleteOperation/
// usePauseWorkOrder/useResumeWorkOrder with no permission check at all — fixed in
// Round 5 by hard fail-closing every action (no manufacturing.work_orders.* key
// exists in the live catalog). Round 6 finding: the *reads* were left
// inconsistent — useWorkOrders and useWorkCenterSummary still fired
// unconditionally for anyone who merely held manufacturing.work_centers.read,
// so work-order rows and derived summary counts were visible to a user who can
// only read work-center reference data. This file goes through the real
// useMES hooks (mocking only the mesService/supabase boundary underneath) to
// prove zero work-order network calls ever occur, while work-center reference
// data stays gated by its own real key.

import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hasPermissionKeyMock = vi.fn((_key: string) => false);
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermissionKey: (key: string) => hasPermissionKeyMock(key) }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

const WORK_CENTERS = [{ id: 'wc-1', name: 'Assembly', name_ar: 'التجميع', is_active: true }];

const fromSpy = vi.fn((table: string) => ({
  select: () => ({
    eq: () => ({
      eq: () => Promise.resolve(table === 'work_centers' ? { data: WORK_CENTERS, error: null } : { data: [], error: null }),
    }),
  }),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { from: (table: string) => fromSpy(table) },
  getEffectiveTenantId: () => Promise.resolve('org-1'),
}));

const WORK_ORDER = {
  id: 'wo-1',
  work_order_number: 'WO-1',
  operation_sequence: 1,
  operation_name: 'Mix',
  status: 'READY',
  planned_quantity: 100,
  completed_quantity: 0,
  scrapped_quantity: 0,
  planned_setup_time: 10,
  planned_run_time: 20,
  actual_setup_time: 0,
  actual_run_time: 0,
};

const getWorkOrders = vi.fn().mockResolvedValue([WORK_ORDER]);
const getWorkCenterSummary = vi.fn().mockResolvedValue({ pending: 1, in_progress: 0, completed_today: 0, total_produced_today: 0, efficiency: 100 });
const startOperation = vi.fn().mockResolvedValue(WORK_ORDER);
const completeOperation = vi.fn().mockResolvedValue(WORK_ORDER);
const pauseWorkOrder = vi.fn().mockResolvedValue(WORK_ORDER);
const resumeWorkOrder = vi.fn().mockResolvedValue(WORK_ORDER);

vi.mock('@/services/manufacturing/mesService', () => ({
  mesService: {
    getWorkOrders: (...args: unknown[]) => getWorkOrders(...args),
    getWorkCenterSummary: (...args: unknown[]) => getWorkCenterSummary(...args),
    startOperation: (...args: unknown[]) => startOperation(...args),
    completeOperation: (...args: unknown[]) => completeOperation(...args),
    pauseWorkOrder: (...args: unknown[]) => pauseWorkOrder(...args),
    resumeWorkOrder: (...args: unknown[]) => resumeWorkOrder(...args),
  },
}));

import { WorkCenterDashboard } from '../mes/WorkCenterDashboard';

function setPermissions(keys: readonly string[]) {
  hasPermissionKeyMock.mockImplementation((key: string) => keys.includes(key));
}

function renderDashboard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <WorkCenterDashboard />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  hasPermissionKeyMock.mockReturnValue(false);
});

describe('WorkCenterDashboard (MES) — reads fail closed with mutations: no manufacturing.work_orders.* key exists', () => {
  it('a user with only manufacturing.work_centers.read sees the work-center list but zero work-order requests fire', async () => {
    setPermissions(['manufacturing.work_centers.read']);
    renderDashboard();

    await waitFor(() => expect(fromSpy).toHaveBeenCalledWith('work_centers'));
    expect(screen.getByText('wcDashboard.empty.title')).toBeInTheDocument();
    expect(getWorkOrders).not.toHaveBeenCalled();
    expect(getWorkCenterSummary).not.toHaveBeenCalled();
  });

  it('even with every permission granted (including a hypothetical work_orders key), reads and writes stay fail-closed', async () => {
    hasPermissionKeyMock.mockReturnValue(true); // simulate every key, incl. non-existent ones, granted
    renderDashboard();

    await waitFor(() => expect(fromSpy).toHaveBeenCalledWith('work_centers'));
    expect(getWorkOrders).not.toHaveBeenCalled();
    expect(getWorkCenterSummary).not.toHaveBeenCalled();

    expect(screen.queryByText('WO-1')).not.toBeInTheDocument();
    expect(screen.queryByText('wcDashboard.card.startSetup')).not.toBeInTheDocument();
    expect(screen.queryByText('wcDashboard.card.startProduction')).not.toBeInTheDocument();
    expect(screen.queryByText('wcDashboard.card.pause')).not.toBeInTheDocument();
    expect(screen.queryByText('wcDashboard.card.resume')).not.toBeInTheDocument();
    expect(screen.queryByText('wcDashboard.card.reportOutput')).not.toBeInTheDocument();

    expect(startOperation).not.toHaveBeenCalled();
    expect(completeOperation).not.toHaveBeenCalled();
    expect(pauseWorkOrder).not.toHaveBeenCalled();
    expect(resumeWorkOrder).not.toHaveBeenCalled();
  });

  it('without manufacturing.work_centers.read, the work-center reference query never fires either', async () => {
    setPermissions([]);
    renderDashboard();

    await new Promise((resolve) => setTimeout(resolve, 50));

    const workCenterCalls = fromSpy.mock.calls.filter(([table]) => table === 'work_centers');
    expect(workCenterCalls).toHaveLength(0);
    expect(getWorkOrders).not.toHaveBeenCalled();
    expect(getWorkCenterSummary).not.toHaveBeenCalled();
  });
});
