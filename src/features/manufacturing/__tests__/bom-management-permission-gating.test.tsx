// src/features/manufacturing/__tests__/bom-management-permission-gating.test.tsx
//
// BOMManagement كانت تنفّذ إنشاء/تعديل/اعتماد/نسخ/حذف قوائم المواد تحت
// manufacturing.boms.read وحدها، وتُنقّل صفوف الجدول إلى مسار
// /manufacturing/bom/:id غير المسجَّل (لا في route-permissions.ts ولا في
// <Routes> الخاصة بـManufacturingModule) — فيسقط المستخدم في إعادة توجيه
// صامتة لصفحة النظرة العامة. هذا الاختبار يثبت الفصل الفعلي على مفاتيح
// manufacturing.boms.create/.update/.approve/.delete (النسخ = boms.create
// لأنه إدراج فعليًا)، ويثبت أن النقر على صف الجدول لم يعد يستدعي أي تنقّل.

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

vi.mock('@/store/auth-store', () => ({
  useAuthStore: () => ({ user: { id: 'user-1' } }),
}));

vi.mock('@/lib/supabase', () => ({
  getEffectiveTenantId: () => Promise.resolve('org-1'),
}));

const deleteBOMMutate = vi.fn().mockResolvedValue(undefined);
const approveBOMMutate = vi.fn().mockResolvedValue(undefined);
const copyBOMMutate = vi.fn().mockResolvedValue(undefined);

const BOM = {
  id: 'bom-1',
  bom_number: 'BOM-001',
  item_code: 'ITEM-1',
  item_name: 'Widget',
  bom_version: 1,
  status: 'DRAFT',
  is_active: true,
  unit_cost: 12.5,
  effective_date: '2026-01-01',
};

vi.mock('@/hooks/manufacturing/useBOM', () => ({
  useBOMs: () => ({ data: [BOM], isLoading: false }),
  useDeleteBOM: () => ({ mutateAsync: (...args: unknown[]) => deleteBOMMutate(...args) }),
  useApproveBOM: () => ({ mutateAsync: (...args: unknown[]) => approveBOMMutate(...args) }),
  useCopyBOM: () => ({ mutateAsync: (...args: unknown[]) => copyBOMMutate(...args) }),
}));

import { BOMManagement } from '../bom/BOMManagement';

function setPermissions(keys: readonly string[]) {
  hasPermissionKeyMock.mockImplementation((key: string) => keys.includes(key));
}

function renderManagement() {
  return render(
    <MemoryRouter>
      <BOMManagement />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  hasPermissionKeyMock.mockReturnValue(false);
});

describe('BOMManagement — manufacturing.boms.create/.update/.approve/.delete', () => {
  it('hides every row action and the header/empty-state create triggers without any boms.* action key', async () => {
    setPermissions(['manufacturing.boms.read']);
    renderManagement();

    await waitFor(() => expect(screen.getByText('BOM-001')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /قائمة جديدة/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /تعديل/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /اعتماد/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /نسخ/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /حذف/ })).not.toBeInTheDocument();
  });

  it('an update grant shows edit and navigates to the edit route on click', async () => {
    setPermissions(['manufacturing.boms.read', 'manufacturing.boms.update']);
    renderManagement();

    await waitFor(() => expect(screen.getByText('BOM-001')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'تعديل BOM-001' }));

    expect(navigateMock).toHaveBeenCalledWith('/manufacturing/bom/bom-1/edit');
  });

  it('an approve grant shows approve on a DRAFT row and calls the approve gateway', async () => {
    setPermissions(['manufacturing.boms.read', 'manufacturing.boms.approve']);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderManagement();

    await waitFor(() => expect(screen.getByText('BOM-001')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'اعتماد BOM-001' }));

    await waitFor(() => expect(approveBOMMutate).toHaveBeenCalledWith('bom-1'));
  });

  it('a create grant shows copy (copy = insert, gated by boms.create) and calls the copy gateway', async () => {
    setPermissions(['manufacturing.boms.read', 'manufacturing.boms.create']);
    vi.spyOn(window, 'prompt').mockReturnValue('BOM-001-COPY');
    renderManagement();

    await waitFor(() => expect(screen.getByText('BOM-001')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /قائمة جديدة/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'نسخ BOM-001' }));

    await waitFor(() => expect(copyBOMMutate).toHaveBeenCalledWith({ sourceBomId: 'bom-1', newBomNumber: 'BOM-001-COPY' }));
  });

  it('a delete grant shows delete on a DRAFT row and calls the delete gateway', async () => {
    setPermissions(['manufacturing.boms.read', 'manufacturing.boms.delete']);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderManagement();

    await waitFor(() => expect(screen.getByText('BOM-001')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'حذف BOM-001' }));

    await waitFor(() => expect(deleteBOMMutate).toHaveBeenCalledWith('bom-1'));
  });

  it('clicking a table row no longer triggers any navigation (broken /bom/:id view route removed)', async () => {
    setPermissions(['manufacturing.boms.read', 'manufacturing.boms.update']);
    renderManagement();

    await waitFor(() => expect(screen.getByText('BOM-001')).toBeInTheDocument());
    await userEvent.click(screen.getByText('BOM-001'));

    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('mid-session revocation of update hides the edit control and blocks navigation for an in-progress attempt', async () => {
    setPermissions(['manufacturing.boms.read', 'manufacturing.boms.update']);
    const { rerender } = renderManagement();

    await waitFor(() => expect(screen.getByText('BOM-001')).toBeInTheDocument());

    setPermissions(['manufacturing.boms.read']);
    rerender(
      <MemoryRouter>
        <BOMManagement />
      </MemoryRouter>
    );

    // canUpdate يغلّف زر التعديل مباشرة (لا حالة "مفتوح" منفصلة هنا)، فلا
    // يبقى عنصر يمكن نقره لإتمام محاولة تعديل كانت جارية. handleEdit نفسها
    // تبدأ أيضًا بفحص canUpdate دفاعًا في العمق.
    expect(screen.queryByRole('button', { name: 'تعديل BOM-001' })).not.toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
