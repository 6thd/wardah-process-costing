// src/features/accounting/journal-entries/__tests__/journal-entries-permission-gating.test.tsx
//
// /accounting/journal-entries had zero permission checks beyond the
// route-level accounting.journals.read entry gate: any user who cleared
// that single .read key could create, edit, post, delete and reverse
// journal entries, batch-post, and "approve" through ApprovalWorkflow
// (whose canApprove prop was hardcoded to true). It also loaded the Chart
// of Accounts (gl_accounts, a different resource — accounting.accounts.*)
// unconditionally. This file mounts the real component and hooks (not
// mocked stand-ins) against a generic Supabase mock to prove: each action
// requires its own exact key, reference-data queries require their own
// exact key, and mid-session revocation blocks both the trigger and the
// underlying handler.

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hasPermissionKeyMock = vi.fn((_key: string) => false);
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermissionKey: (key: string) => hasPermissionKeyMock(key) }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
    i18n: { language: 'ar' },
  }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

const DRAFT_ENTRY = {
  id: 'entry-1',
  entry_number: 'JE-0001',
  entry_date: '2026-01-01',
  description: 'Draft entry',
  description_ar: 'قيد مسودة',
  status: 'draft',
  journal_id: 'j-1',
  journal_name: 'Cash Journal',
  total_debit: 100,
  total_credit: 100,
};

const POSTED_ENTRY = {
  id: 'entry-2',
  entry_number: 'JE-0002',
  entry_date: '2026-01-02',
  description: 'Posted entry',
  description_ar: 'قيد مرحّل',
  status: 'posted',
  journal_id: 'j-1',
  journal_name: 'Cash Journal',
  total_debit: 200,
  total_credit: 200,
  reversed_by_entry_id: null,
};

const TABLE_RESULTS: Record<string, { data: unknown; error: unknown }> = {
  gl_entries: { data: [DRAFT_ENTRY, POSTED_ENTRY], error: null },
  journals: { data: [{ id: 'j-1', code: 'CJ', name: 'Cash Journal', name_ar: 'دفتر النقدية', is_active: true }], error: null },
  gl_accounts: { data: [{ id: 'acc-1', code: '1000', name: 'Cash', is_active: true, allow_posting: true }], error: null },
  gl_entry_lines: { data: [{ id: 'l1', entry_id: 'entry-1', line_number: 1, account_id: 'acc-1', debit: 100, credit: 0 }], error: null },
};

const fromSpy = vi.fn((table: string) => {
  const result = TABLE_RESULTS[table] ?? { data: [], error: null };
  const builder = Promise.resolve(result) as Promise<typeof result> & Record<string, unknown>;
  const chain = ['select', 'insert', 'update', 'delete', 'eq', 'order', 'gte', 'in', 'limit'];
  for (const method of chain) {
    builder[method] = vi.fn(() => builder);
  }
  builder.single = vi.fn(() => Promise.resolve(result));
  return builder;
});

vi.mock('@/lib/supabase', () => ({
  supabase: { from: (table: string) => fromSpy(table) },
}));

vi.mock('@/lib/performance-monitor', () => ({
  PerformanceMonitor: { measure: async (_label: string, fn: () => Promise<unknown>) => fn() },
}));

const createJournalEntryMock = vi.fn().mockResolvedValue('new-entry-id');
const updateJournalEntryMock = vi.fn().mockResolvedValue(true);
const postJournalEntryMock = vi.fn().mockResolvedValue(true);
const deleteJournalEntryMock = vi.fn().mockResolvedValue(true);

vi.mock('../services/journalEntryService', () => ({
  createJournalEntry: (...args: unknown[]) => createJournalEntryMock(...args),
  updateJournalEntry: (...args: unknown[]) => updateJournalEntryMock(...args),
  postJournalEntry: (...args: unknown[]) => postJournalEntryMock(...args),
  deleteJournalEntry: (...args: unknown[]) => deleteJournalEntryMock(...args),
}));

const reverseEntryMock = vi.fn().mockResolvedValue({ success: true });
const getEntryWithDetailsMock = vi.fn().mockResolvedValue({ ...POSTED_ENTRY, lines: [] });

vi.mock('@/services/accounting/journal-service', () => ({
  JournalService: {
    reverseEntry: (...args: unknown[]) => reverseEntryMock(...args),
    getEntryWithDetails: (...args: unknown[]) => getEntryWithDetailsMock(...args),
    getEntryApprovals: vi.fn().mockResolvedValue([]),
    checkApprovalRequired: vi.fn().mockResolvedValue({ required: false, required_levels: 0, current_levels: 0 }),
    approveEntry: vi.fn().mockResolvedValue({ success: true }),
  },
}));

import JournalEntries from '../index';

function setPermissions(keys: readonly string[]) {
  hasPermissionKeyMock.mockImplementation((key: string) => keys.includes(key));
}

beforeEach(() => {
  vi.clearAllMocks();
  hasPermissionKeyMock.mockReturnValue(false);
});

const CAN_READ = ['accounting.journals.read'] as const;

describe('journal-entries — reference-data reads require their own exact key', () => {
  it('accounting.journals.read alone loads entries and journal types, but never gl_accounts', async () => {
    setPermissions([...CAN_READ]);
    render(<JournalEntries />);

    await waitFor(() => expect(fromSpy).toHaveBeenCalledWith('gl_entries'));
    await waitFor(() => expect(fromSpy).toHaveBeenCalledWith('journals'));
    expect(fromSpy).not.toHaveBeenCalledWith('gl_accounts');
  });

  it('accounting.journals.read + accounting.accounts.read loads gl_accounts too', async () => {
    setPermissions([...CAN_READ, 'accounting.accounts.read']);
    render(<JournalEntries />);

    await waitFor(() => expect(fromSpy).toHaveBeenCalledWith('gl_accounts'));
  });

  it('without accounting.journals.read, the entries list query never fires', async () => {
    setPermissions([]);
    render(<JournalEntries />);

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fromSpy).not.toHaveBeenCalledWith('gl_entries');
  });
});

describe('journal-entries — create requires accounting.journals.create', () => {
  it('read-only user has no "new entry" trigger', async () => {
    setPermissions([...CAN_READ]);
    render(<JournalEntries />);

    await waitFor(() => expect(screen.getByText('JE-0001')).toBeInTheDocument());
    expect(screen.queryByText('accounting.journalEntries.newEntry')).not.toBeInTheDocument();
  });

  it('a create grant opens the dialog and a real submit calls the create gateway', async () => {
    setPermissions([...CAN_READ, 'accounting.journals.create', 'accounting.accounts.read']);
    render(<JournalEntries />);

    await waitFor(() => expect(screen.getByText('JE-0001')).toBeInTheDocument());
    await userEvent.click(screen.getByText('accounting.journalEntries.newEntry'));
    expect(screen.getByText('accounting.journalEntries.enterDetails')).toBeInTheDocument();
  });
});

describe('journal-entries — row actions on a DRAFT entry require their own exact key', () => {
  it('read-only user sees no edit/post/delete controls on the draft row', async () => {
    setPermissions([...CAN_READ]);
    render(<JournalEntries />);

    await waitFor(() => expect(screen.getByText('JE-0001')).toBeInTheDocument());
    const row = screen.getByText('JE-0001').closest('tr')!;
    expect(within(row).queryByTitle('common.edit')).not.toBeInTheDocument();
    expect(within(row).queryByTitle('accounting.journalEntries.post')).not.toBeInTheDocument();
    expect(within(row).queryByTitle('common.delete')).not.toBeInTheDocument();
  });

  it('accounting.journals.approve grants post and calls the post gateway, not create/update/delete', async () => {
    setPermissions([...CAN_READ, 'accounting.journals.approve']);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<JournalEntries />);

    await waitFor(() => expect(screen.getByText('JE-0001')).toBeInTheDocument());
    const row = screen.getByText('JE-0001').closest('tr')!;
    await userEvent.click(within(row).getByTitle('accounting.journalEntries.post'));

    await waitFor(() => expect(postJournalEntryMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'entry-1' })));
    expect(createJournalEntryMock).not.toHaveBeenCalled();
    expect(deleteJournalEntryMock).not.toHaveBeenCalled();
  });

  it('accounting.journals.delete grants delete and calls the delete gateway', async () => {
    setPermissions([...CAN_READ, 'accounting.journals.delete']);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<JournalEntries />);

    await waitFor(() => expect(screen.getByText('JE-0001')).toBeInTheDocument());
    const row = screen.getByText('JE-0001').closest('tr')!;
    await userEvent.click(within(row).getByTitle('common.delete'));

    await waitFor(() => expect(deleteJournalEntryMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'entry-1' })));
  });

  it('accounting.journals.update grants edit; without accounting.accounts.read the dialog cannot open (fetchEntryLines still runs, but no account picker options)', async () => {
    setPermissions([...CAN_READ, 'accounting.journals.update']);
    render(<JournalEntries />);

    await waitFor(() => expect(screen.getByText('JE-0001')).toBeInTheDocument());
    const row = screen.getByText('JE-0001').closest('tr')!;
    await userEvent.click(within(row).getByTitle('common.edit'));

    await waitFor(() => expect(screen.getByText('accounting.journalEntries.editEntry')).toBeInTheDocument());
  });
});

describe('journal-entries — reverse on a POSTED entry requires accounting.journals.approve', () => {
  it('read-only user sees the view action but no reverse control', async () => {
    setPermissions([...CAN_READ]);
    render(<JournalEntries />);

    await waitFor(() => expect(screen.getByText('JE-0002')).toBeInTheDocument());
    const row = screen.getByText('JE-0002').closest('tr')!;
    expect(within(row).getByTitle('accounting.journalEntries.view')).toBeInTheDocument();
    expect(within(row).queryByTitle('accounting.journalEntries.reverse')).not.toBeInTheDocument();
  });

  it('accounting.journals.approve grants reverse and calls the reverse gateway', async () => {
    setPermissions([...CAN_READ, 'accounting.journals.approve']);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<JournalEntries />);

    await waitFor(() => expect(screen.getByText('JE-0002')).toBeInTheDocument());
    const row = screen.getByText('JE-0002').closest('tr')!;
    await userEvent.click(within(row).getByTitle('accounting.journalEntries.reverse'));

    await waitFor(() => expect(reverseEntryMock).toHaveBeenCalledWith('entry-2'));
  });
});

describe('journal-entries — batch post requires accounting.journals.approve', () => {
  it('hides the batch-post trigger without approve', async () => {
    setPermissions([...CAN_READ]);
    render(<JournalEntries />);

    await waitFor(() => expect(screen.getByText('JE-0001')).toBeInTheDocument());
    expect(screen.queryByText('accounting.journalEntries.batchPost')).not.toBeInTheDocument();
  });

  it('shows the batch-post trigger with approve', async () => {
    setPermissions([...CAN_READ, 'accounting.journals.approve']);
    render(<JournalEntries />);

    await waitFor(() => expect(screen.getByText('accounting.journalEntries.batchPost')).toBeInTheDocument());
  });
});

describe('journal-entries — revoking mid-session hides row controls immediately (dialog/handler boundary)', () => {
  it('revoking approve after the draft row is rendered removes the post control on rerender', async () => {
    setPermissions([...CAN_READ, 'accounting.journals.approve']);
    const { rerender } = render(<JournalEntries />);

    await waitFor(() => expect(screen.getByText('JE-0001')).toBeInTheDocument());
    let row = screen.getByText('JE-0001').closest('tr')!;
    expect(within(row).getByTitle('accounting.journalEntries.post')).toBeInTheDocument();

    setPermissions([...CAN_READ]);
    rerender(<JournalEntries />);

    row = screen.getByText('JE-0001').closest('tr')!;
    expect(within(row).queryByTitle('accounting.journalEntries.post')).not.toBeInTheDocument();
    expect(postJournalEntryMock).not.toHaveBeenCalled();
  });
});
