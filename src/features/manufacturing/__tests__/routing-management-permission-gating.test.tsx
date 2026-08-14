// src/features/manufacturing/__tests__/routing-management-permission-gating.test.tsx
//
// حماية دخول /manufacturing/routing/new أو /routing/:id لا تحمي أفعال
// الاعتماد/النسخ/الحذف المنفَّذة مباشرة من القائمة للقراءة فقط. هذا الاختبار
// يثبت الفصل الفعلي: التوجيه (routing) يُحكَم بمفتاح stages (لا مورد مخصص في
// الكتالوج الحي)، والاعتماد لا مفتاح مطابق له إطلاقًا فيُغلَق دائمًا
// (fail-closed) بصرف النظر عن أي صلاحية.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hasPermissionKeyMock = vi.fn((_key: string) => false);
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermissionKey: (key: string) => hasPermissionKeyMock(key) }),
}));

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

vi.mock('@/store/auth-store', () => ({
  useAuthStore: () => ({ user: { id: 'user-1' } }),
}));

vi.mock('@/lib/supabase', () => ({
  getEffectiveTenantId: () => Promise.resolve('org-1'),
}));

const deleteRoutingMutate = vi.fn();
const approveRoutingMutate = vi.fn();
const copyRoutingMutate = vi.fn();

const ROUTING = {
  id: 'routing-1',
  routing_code: 'RT-001',
  routing_name: 'Main Routing',
  routing_name_ar: 'المسار الرئيسي',
  version: 1,
  status: 'DRAFT',
  is_active: true,
  effective_date: '2026-01-01',
};

vi.mock('@/hooks/manufacturing/useRouting', () => ({
  useRoutings: () => ({ data: [ROUTING], isLoading: false, refetch: vi.fn() }),
  useDeleteRouting: () => ({ mutate: (...args: unknown[]) => deleteRoutingMutate(...args) }),
  useApproveRouting: () => ({ mutate: (...args: unknown[]) => approveRoutingMutate(...args) }),
  useCopyRouting: () => ({ mutate: (...args: unknown[]) => copyRoutingMutate(...args) }),
}));

import { RoutingManagement } from '../routing/RoutingManagement';

function setPermissions(keys: readonly string[]) {
  hasPermissionKeyMock.mockImplementation((key: string) => keys.includes(key));
}

function renderList() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <RoutingManagement />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  hasPermissionKeyMock.mockReturnValue(false);
});

describe('RoutingManagement list — manufacturing.stages.create/.update/.delete (nearest resource) + fail-closed approve', () => {
  it('hides every row action and the header create trigger without any stages.* action key', async () => {
    setPermissions(['manufacturing.stages.read']);
    renderList();

    await waitFor(() => expect(screen.getByText('RT-001')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'routingMgmt.newRouting' })).not.toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toHaveLength(1); // فقط زر "تحديث" (refresh) غير المرتبط بصلاحية أفعال
  });

  it('a delete grant shows delete on a DRAFT row and calls the delete gateway', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    setPermissions(['manufacturing.stages.read', 'manufacturing.stages.delete']);
    renderList();

    await waitFor(() => expect(screen.getByText('RT-001')).toBeInTheDocument());
    const buttons = screen.getAllByRole('button');
    const deleteBtn = buttons.find((b) => b.className.includes('text-red-600'));
    expect(deleteBtn).toBeTruthy();
    await userEvent.click(deleteBtn!);

    expect(deleteRoutingMutate).toHaveBeenCalledWith('routing-1');
  });

  it('a create grant shows copy (copy = insert, gated by stages.create) and calls the copy gateway', async () => {
    setPermissions(['manufacturing.stages.read', 'manufacturing.stages.create']);
    renderList();

    await waitFor(() => expect(screen.getByText('RT-001')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'routingMgmt.newRouting' })).toBeInTheDocument();

    // زر النسخ ليس له نص مميّز؛ نحدده بأنه الزر الإضافي غير "تحديث"/"مسار جديد"
    const buttons = screen.getAllByRole('button');
    const copyBtn = buttons.find(
      (b) => !b.textContent?.includes('routingMgmt.refresh') && !b.textContent?.includes('routingMgmt.newRouting')
    );
    expect(copyBtn).toBeTruthy();
    await userEvent.click(copyBtn!);

    expect(copyRoutingMutate).toHaveBeenCalledWith(expect.objectContaining({ id: 'routing-1' }));
  });

  it('approve is never offered regardless of permission — no manufacturing.stages.approve exists in the live catalog', async () => {
    setPermissions([
      'manufacturing.stages.read',
      'manufacturing.stages.create',
      'manufacturing.stages.update',
      'manufacturing.stages.delete',
      // حتى لو مُنح خطأً مفتاح لا وجود له في الكتالوج الحي، الاعتماد يبقى مغلقًا
      'manufacturing.stages.approve',
    ]);
    renderList();

    await waitFor(() => expect(screen.getByText('RT-001')).toBeInTheDocument());
    const approveButtons = screen.queryAllByRole('button').filter((b) => b.className.includes('text-green-600'));
    expect(approveButtons).toHaveLength(0);
    expect(approveRoutingMutate).not.toHaveBeenCalled();
  });
});
