// src/pages/org-admin/__tests__/roles-read-failures.test.tsx
//
// Regression tests for the role editor's read-failure paths (F1, F3).
//
// rpc_upsert_org_role replaces a role's complete permission set. Before this
// fix, a failed role_permissions read opened the editor with no grants (F1),
// and a failed or stale permission catalogue silently dropped selected ids
// from the payload (F3) — either way an ordinary "save" became a revocation.
// These tests mount the real page and the real org-admin service over a
// mocked Supabase client.

import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { usedMethod, type QueryResolver } from './supabase-query-mock';

const rpcMock = vi.fn();
let resolver: QueryResolver;

vi.mock('@/lib/supabase', async () => {
  const { makeFrom: mf } = await import('./supabase-query-mock');
  return {
    getSupabase: () => ({ rpc: rpcMock, from: mf(() => resolver) }),
  };
});

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ currentOrgId: 'org-1', user: { id: 'u1' }, isAuthenticated: true }),
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import OrgAdminRoles from '../roles';
import { toast } from 'sonner';

const SENSITIVE = 'accounting.vouchers.unpost';
const APPROVE = 'accounting.entries.approve';

const MODULES = [
  {
    id: 'mod-acc', code: 'accounting', name: 'accounting', name_ar: 'المحاسبة',
    display_order: 1,
    permissions: [
      {
        id: 'perm-unpost', module_id: 'mod-acc', resource: 'vouchers', resource_ar: 'السندات',
        action: 'unpost', action_ar: 'إلغاء ترحيل', permission_key: SENSITIVE,
      },
      {
        id: 'perm-approve', module_id: 'mod-acc', resource: 'entries', resource_ar: 'القيود',
        action: 'approve', action_ar: 'اعتماد', permission_key: APPROVE,
      },
    ],
  },
];

const ROLE = {
  id: 'role-1', org_id: 'org-1', name: 'Existing', name_ar: 'قائم', description: '',
  is_system_role: false, is_active: true, created_at: '2026-09-01T00:00:00Z',
};

type Result = { data: unknown; error: unknown };
const ok = (data: unknown): Result => ({ data, error: null });
const failed = (message: string): Result => ({ data: null, error: { message, code: '42501' } });

// Per-test knobs; each is either a result or a function that throws.
let catalog: () => Result;
let rolePermissionsForEditor: () => Result;

beforeEach(() => {
  vi.clearAllMocks();
  rpcMock.mockReset();

  catalog = () => ok(MODULES);
  rolePermissionsForEditor = () =>
    ok([{ permission_id: 'perm-unpost' }, { permission_id: 'perm-approve' }]);

  resolver = (table, calls) => {
    switch (table) {
      case 'roles':
        return ok([ROLE]);
      case 'role_templates':
        return ok([]);
      case 'modules':
        return catalog();
      case 'role_permissions':
        // `.in` = per-role counts for the list; `.eq` = the editor's current grants.
        if (usedMethod(calls, 'in')) return ok([{ role_id: 'role-1' }, { role_id: 'role-1' }]);
        return rolePermissionsForEditor();
      default:
        throw new Error(`unexpected table ${table}`);
    }
  };

  rpcMock.mockImplementation(async (fn: string) => {
    if (fn === 'rpc_permission_snapshot') {
      return {
        data: {
          user_id: 'u1', org_id: 'org-1', is_super_admin: false, is_org_admin: true,
          permission_keys: [APPROVE],
          sensitive_permission_keys: [SENSITIVE],
          generated_at: '2026-09-27T00:00:00Z',
        },
        error: null,
      };
    }
    return { data: { role_id: 'role-1' }, error: null };
  });
});

function upsertCalls() {
  return rpcMock.mock.calls.filter(c => c[0] === 'rpc_upsert_org_role');
}

async function renderPage() {
  render(<OrgAdminRoles />);
  await waitFor(() => expect(screen.getByText('قائم')).toBeInTheDocument());
}

async function openEditor() {
  fireEvent.click(screen.getByRole('button', { name: 'تعديل دور قائم' }));
}

function editorDialog() {
  return screen.getByRole('dialog', { name: 'تعديل الدور' });
}

function saveButton() {
  return within(editorDialog()).getByRole('button', { name: 'حفظ التغييرات' });
}

function submitEditor() {
  // Submit the form directly as well, so the guard is proven in the handler
  // and not only by the disabled button.
  fireEvent.click(saveButton());
  const form = editorDialog().querySelector('form');
  if (form) fireEvent.submit(form);
}

function clickRefresh() {
  // The header refresh button sits behind the modal (aria-hidden), which is
  // exactly the "refresh while an editor is open" case under test.
  const btn = document.querySelector('[aria-label="تحديث قائمة الأدوار"]') as HTMLElement;
  fireEvent.click(btn);
}

describe('F1 — failed role_permissions read never opens a saveable editor', () => {
  it('returned Supabase error: editor stays closed and no upsert is sent', async () => {
    rolePermissionsForEditor = () => failed('permission denied for table role_permissions');
    await renderPage();
    await openEditor();

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('تعذر تحميل صلاحيات الدور'))
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(upsertCalls()).toHaveLength(0);
  });

  it('thrown read error: editor stays closed and no upsert is sent', async () => {
    rolePermissionsForEditor = () => {
      throw new Error('network down');
    };
    await renderPage();
    await openEditor();

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('تعذر تحميل صلاحيات الدور'))
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(upsertCalls()).toHaveLength(0);
  });
});

describe('F3 — failed permission catalogue never produces a reduced payload', () => {
  it('initial catalogue load returns an error: editor with grants cannot save', async () => {
    catalog = () => failed('permission denied for table modules');
    await renderPage();
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('تعذر تحميل قائمة الصلاحيات'))
    );

    await openEditor();
    await waitFor(() => expect(editorDialog()).toBeInTheDocument());
    // The role's two grants are still represented, not collapsed to zero.
    expect(within(editorDialog()).getByText('2 محددة')).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
    expect(screen.getByTestId('role-save-blocked')).toHaveTextContent('تعذر تحميل قائمة الصلاحيات');

    submitEditor();
    await Promise.resolve();
    expect(upsertCalls()).toHaveLength(0);
  });

  it('initial catalogue load throws: editor with grants cannot save', async () => {
    catalog = () => {
      throw new Error('socket hang up');
    };
    await renderPage();
    await openEditor();
    await waitFor(() => expect(editorDialog()).toBeInTheDocument());

    expect(saveButton()).toBeDisabled();
    submitEditor();
    await Promise.resolve();
    expect(upsertCalls()).toHaveLength(0);
  });

  it.each([
    ['returned error', () => failed('upstream timeout')],
    ['thrown error', () => { throw new Error('fetch failed'); }],
  ])('refresh fails (%s) while the editor is open: selection kept, save blocked, then recovers', async (_label, failure) => {
    await renderPage();
    await openEditor();
    await waitFor(() => expect(editorDialog()).toBeInTheDocument());
    expect(within(editorDialog()).getByText('2 محددة')).toBeInTheDocument();
    await waitFor(() => expect(saveButton()).not.toBeDisabled());

    catalog = failure as () => Result;
    clickRefresh();

    await waitFor(() => expect(saveButton()).toBeDisabled());
    // The visible selection survives the failed refresh.
    expect(within(editorDialog()).getByText('2 محددة')).toBeInTheDocument();
    expect(within(editorDialog()).getByText('المحاسبة')).toBeInTheDocument();
    submitEditor();
    await Promise.resolve();
    expect(upsertCalls()).toHaveLength(0);

    // A later successful refresh re-enables saving with the complete set.
    catalog = () => ok(MODULES);
    clickRefresh();
    await waitFor(() => expect(saveButton()).not.toBeDisabled());
    fireEvent.click(saveButton());

    await waitFor(() => expect(upsertCalls()).toHaveLength(1));
    expect(upsertCalls()[0][1].p_payload.permission_keys).toEqual([SENSITIVE, APPROVE]);
  });

  it('a selected id missing from a successfully loaded catalogue blocks the save', async () => {
    rolePermissionsForEditor = () =>
      ok([{ permission_id: 'perm-approve' }, { permission_id: 'perm-removed' }]);
    await renderPage();
    await openEditor();
    await waitFor(() => expect(editorDialog()).toBeInTheDocument());

    expect(saveButton()).toBeDisabled();
    expect(screen.getByTestId('role-save-blocked')).toHaveTextContent('غير موجودة في القائمة');
    submitEditor();
    await Promise.resolve();
    expect(upsertCalls()).toHaveLength(0);
  });
});

describe('controls — successful reads keep the normal Org Admin workflow', () => {
  it('successful non-empty read saves the complete selected set', async () => {
    await renderPage();
    await openEditor();
    await waitFor(() => expect(saveButton()).not.toBeDisabled());
    fireEvent.click(saveButton());

    await waitFor(() => expect(upsertCalls()).toHaveLength(1));
    expect(upsertCalls()[0][1]).toEqual({
      p_payload: expect.objectContaining({
        org_id: 'org-1',
        role_id: 'role-1',
        permission_keys: [SENSITIVE, APPROVE],
      }),
    });
  });

  it('successful empty read permits an intentional empty save', async () => {
    rolePermissionsForEditor = () => ok([]);
    await renderPage();
    await openEditor();
    await waitFor(() => expect(saveButton()).not.toBeDisabled());
    expect(within(editorDialog()).getByText('0 محددة')).toBeInTheDocument();
    fireEvent.click(saveButton());

    await waitFor(() => expect(upsertCalls()).toHaveLength(1));
    expect(upsertCalls()[0][1].p_payload.permission_keys).toEqual([]);
  });

  it('admin can deliberately remove every permission after a successful read', async () => {
    const user = userEvent.setup();
    await renderPage();
    await openEditor();
    await waitFor(() => expect(saveButton()).not.toBeDisabled());

    await user.click(within(editorDialog()).getByRole('checkbox', { name: 'تحديد كل صلاحيات المحاسبة' }));
    expect(within(editorDialog()).getByText('0 محددة')).toBeInTheDocument();
    await user.click(saveButton());

    await waitFor(() => expect(upsertCalls()).toHaveLength(1));
    expect(upsertCalls()[0][1].p_payload.permission_keys).toEqual([]);
  });

  it('normal creation still works and still warns about a sensitive key', async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByText('دور جديد'));
    await user.type(screen.getByLabelText('الاسم بالعربية *'), 'مدقق السندات');
    await user.click(await screen.findByText('المحاسبة'));
    await user.click(screen.getByRole('button', { name: /السندات - إلغاء ترحيل/ }));

    expect(screen.getByText('هذا الدور يمنح صلاحيات حساسة')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'إنشاء الدور' }));

    await waitFor(() => expect(upsertCalls()).toHaveLength(1));
    expect(upsertCalls()[0][1]).toEqual({
      p_payload: expect.objectContaining({ role_id: null, permission_keys: [SENSITIVE] }),
    });
  });
});
