// src/features/manufacturing/__tests__/work-center-dashboard-fail-closed.test.tsx
//
// WorkCenterDashboard (MES) كانت تنفّذ بدء/إيقاف مؤقت/استئناف/إنهاء أوامر
// العمل بلا أي فحص صلاحية. لا يوجد مفتاح مطابق لهذه الأفعال في الكتالوج الحي
// (لا manufacturing.work_orders.* ولا مورد مكافئ)، فأُغلقت افتراضيًا
// (fail-closed) بدل ربطها بمفتاح غير ذي صلة. هذا الاختبار يثبت الإغلاق: كل
// أزرار الفعل غائبة، وبوابات الكتابة لا تُستدعى أبدًا مهما كانت الصلاحيات.

import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hasPermissionKeyMock = vi.fn((_key: string) => true); // حتى مع منح كل الصلاحيات
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermissionKey: (key: string) => hasPermissionKeyMock(key) }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => Promise.resolve({ data: [{ id: 'wc-1', name: 'Assembly', name_ar: 'التجميع', is_active: true }], error: null }),
        }),
      }),
    }),
  },
  getEffectiveTenantId: () => Promise.resolve('org-1'),
}));

const startOperationMutate = vi.fn();
const completeOperationMutate = vi.fn();
const pauseWorkOrderMutate = vi.fn();
const resumeWorkOrderMutate = vi.fn();

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

vi.mock('@/hooks/manufacturing/useMES', () => ({
  useWorkOrders: () => ({ data: [WORK_ORDER], isLoading: false, refetch: vi.fn() }),
  useStartOperation: () => ({ mutate: (...args: unknown[]) => startOperationMutate(...args) }),
  useCompleteOperation: () => ({ mutate: (...args: unknown[]) => completeOperationMutate(...args) }),
  usePauseWorkOrder: () => ({ mutate: (...args: unknown[]) => pauseWorkOrderMutate(...args) }),
  useResumeWorkOrder: () => ({ mutate: (...args: unknown[]) => resumeWorkOrderMutate(...args) }),
  useWorkCenterSummary: () => ({ data: undefined }),
}));

import { WorkCenterDashboard } from '../mes/WorkCenterDashboard';

beforeEach(() => {
  vi.clearAllMocks();
  hasPermissionKeyMock.mockReturnValue(true);
});

describe('WorkCenterDashboard (MES) — fail-closed: no manufacturing.work_orders.* key exists in the live catalog', () => {
  it('renders the active work order but offers no start/pause/resume/complete controls, even with every permission granted', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <WorkCenterDashboard />
      </QueryClientProvider>
    );

    await waitFor(() => expect(screen.getByText('WO-1')).toBeInTheDocument());

    expect(screen.queryByText('wcDashboard.card.startSetup')).not.toBeInTheDocument();
    expect(screen.queryByText('wcDashboard.card.startProduction')).not.toBeInTheDocument();
    expect(screen.queryByText('wcDashboard.card.pause')).not.toBeInTheDocument();
    expect(screen.queryByText('wcDashboard.card.resume')).not.toBeInTheDocument();
    expect(screen.queryByText('wcDashboard.card.reportOutput')).not.toBeInTheDocument();

    expect(startOperationMutate).not.toHaveBeenCalled();
    expect(completeOperationMutate).not.toHaveBeenCalled();
    expect(pauseWorkOrderMutate).not.toHaveBeenCalled();
    expect(resumeWorkOrderMutate).not.toHaveBeenCalled();
  });
});
