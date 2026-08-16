// src/features/manufacturing/__tests__/manufacturing-stages-list-permission-gating.test.tsx
//
// ManufacturingStagesList كانت تنفّذ إنشاء/تعديل/حذف المراحل تحت
// manufacturing.stages.read وحدها (مفتاح دخول الشاشة عبر ModuleGuard) بلا أي
// فحص لمفاتيح stages.create/.update/.delete. هذا الاختبار يثبت الفصل الفعلي:
// إخفاء المحفّز + منع فتح الحوار + إعادة الفحص داخل المعالج قبل نداء الخدمة.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';

const hasPermissionKeyMock = vi.fn((_key: string) => false);
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermissionKey: (key: string) => hasPermissionKeyMock(key) }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const stagesGetAll = vi.fn();
const stagesCreate = vi.fn().mockResolvedValue({ id: 'new-stage' });
const stagesUpdate = vi.fn().mockResolvedValue({ id: 'stage-1' });
const stagesDelete = vi.fn().mockResolvedValue(undefined);

vi.mock('@/services/supabase-service', () => ({
  manufacturingStagesService: {
    getAll: (...args: unknown[]) => stagesGetAll(...args),
    create: (...args: unknown[]) => stagesCreate(...args),
    update: (...args: unknown[]) => stagesUpdate(...args),
    delete: (...args: unknown[]) => stagesDelete(...args),
  },
}));

import { ManufacturingStagesList } from '../manufacturing-stages-list';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const STAGE = { id: 'stage-1', code: 'MIX', name: 'Mixing', name_ar: 'الخلط', order_sequence: 1, is_active: true, description: '' };

function setPermissions(keys: readonly string[]) {
  hasPermissionKeyMock.mockImplementation((key: string) => keys.includes(key));
}

function renderList() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ManufacturingStagesList />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  hasPermissionKeyMock.mockReturnValue(false);
  stagesGetAll.mockResolvedValue([STAGE]);
});

describe('ManufacturingStagesList — manufacturing.stages.create/.update/.delete', () => {
  it('hides the add-stage trigger without the create key', async () => {
    setPermissions(['manufacturing.stages.read']);
    renderList();

    await waitFor(() => expect(screen.getByText('MIX')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'إضافة مرحلة' })).not.toBeInTheDocument();
  });

  it('hides edit/delete row buttons without update/delete keys', async () => {
    setPermissions(['manufacturing.stages.read']);
    renderList();

    await waitFor(() => expect(screen.getByText('MIX')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'تعديل MIX' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'حذف MIX' })).not.toBeInTheDocument();
  });

  it('a create grant opens the dialog and a real submit calls the create gateway', async () => {
    setPermissions(['manufacturing.stages.read', 'manufacturing.stages.create']);
    renderList();

    await waitFor(() => expect(screen.getByText('MIX')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'إضافة مرحلة' }));

    await userEvent.type(screen.getByLabelText(/كود المرحلة/), 'PACK');
    await userEvent.type(screen.getByLabelText(/اسم المرحلة \(إنجليزي\)/), 'Packaging');

    await userEvent.click(screen.getByRole('button', { name: 'إضافة' }));

    await waitFor(() => expect(stagesCreate).toHaveBeenCalledTimes(1));
    expect(stagesUpdate).not.toHaveBeenCalled();
  });

  it('an update grant shows the edit control; submitting calls the update gateway with the stage id', async () => {
    setPermissions(['manufacturing.stages.read', 'manufacturing.stages.update']);
    renderList();

    await waitFor(() => expect(screen.getByText('MIX')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'تعديل MIX' }));

    await userEvent.click(screen.getByRole('button', { name: 'حفظ التعديلات' }));

    await waitFor(() => expect(stagesUpdate).toHaveBeenCalledWith('stage-1', expect.any(Object)));
    expect(stagesCreate).not.toHaveBeenCalled();
  });

  it('a delete grant shows the delete control; confirming calls the delete gateway', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    setPermissions(['manufacturing.stages.read', 'manufacturing.stages.delete']);
    renderList();

    await waitFor(() => expect(screen.getByText('MIX')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'حذف MIX' }));

    await waitFor(() => expect(stagesDelete).toHaveBeenCalledWith('stage-1'));
  });

  it('revoking create mid-session (dialog already open) blocks the actual submit at the handler boundary', async () => {
    setPermissions(['manufacturing.stages.read', 'manufacturing.stages.create']);
    const { rerender } = renderList();

    await waitFor(() => expect(screen.getByText('MIX')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'إضافة مرحلة' }));
    await userEvent.type(screen.getByLabelText(/كود المرحلة/), 'PACK');
    await userEvent.type(screen.getByLabelText(/اسم المرحلة \(إنجليزي\)/), 'Packaging');

    setPermissions(['manufacturing.stages.read']);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    rerender(
      <QueryClientProvider client={queryClient}>
        <ManufacturingStagesList />
      </QueryClientProvider>
    );

    // الحوار يبقى مفتوحًا (isDialogOpen حالة محلية) — نتحقق أن الإرسال الفعلي محظور
    const submitButtons = screen.queryAllByRole('button', { name: 'إضافة' });
    if (submitButtons.length > 0) {
      await userEvent.click(submitButtons[0]);
    }

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(stagesCreate).not.toHaveBeenCalled();
  });
});
