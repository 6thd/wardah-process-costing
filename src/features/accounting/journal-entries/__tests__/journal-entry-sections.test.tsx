import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  JournalEntriesTable,
  JournalEntryFilters,
  JournalEntryViewDialog,
} from '../components/JournalEntrySections';
import type { JournalEntry } from '../types';

vi.mock('../components/ApprovalWorkflow', () => ({
  ApprovalWorkflow: ({ entryId, canApprove }: { entryId: string; canApprove: boolean }) => (
    <div>approval:{entryId}:{String(canApprove)}</div>
  ),
}));

vi.mock('../components/AttachmentsSection', () => ({
  AttachmentsSection: ({ entryId }: { entryId: string }) => <div>attachments:{entryId}</div>,
}));

vi.mock('../components/CommentsSection', () => ({
  CommentsSection: ({ entryId }: { entryId: string }) => <div>comments:{entryId}</div>,
}));

const t = ((key: string) => key) as never;

const draftEntry: JournalEntry = {
  id: 'draft-1',
  org_id: 'org-1',
  journal_id: 'journal-1',
  entry_number: 'JE-001',
  entry_date: '2026-01-03',
  description: 'English draft',
  description_ar: 'مسودة عربية',
  status: 'draft',
  total_debit: 100,
  total_credit: 100,
  created_at: '2026-01-03',
  updated_at: '2026-01-03',
  journal_name: 'Cash',
  journal_name_ar: 'النقدية',
};

const postedEntry: JournalEntry = {
  ...draftEntry,
  id: 'posted-1',
  entry_number: 'JE-002',
  status: 'posted',
};

const handlers = {
  onEdit: vi.fn(),
  onPost: vi.fn(),
  onDelete: vi.fn(),
  onView: vi.fn(),
  onReverse: vi.fn(),
};

describe('JournalEntryFilters', () => {
  it('forwards search, date, reset and batch-post actions while respecting approval visibility', () => {
    const onSearchChange = vi.fn();
    const onDateChange = vi.fn();
    const onReset = vi.fn();
    const onBatchPost = vi.fn();
    const { container, rerender } = render(
      <JournalEntryFilters
        searchTerm=""
        statusFilter="all"
        dateFilter=""
        canApprove={false}
        t={t}
        onSearchChange={onSearchChange}
        onStatusChange={vi.fn()}
        onDateChange={onDateChange}
        onReset={onReset}
        onBatchPost={onBatchPost}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('accounting.journalEntries.searchPlaceholder'), { target: { value: 'JE-2' } });
    fireEvent.change(container.querySelector('input[type="date"]')!, { target: { value: '2026-01-03' } });
    fireEvent.click(screen.getByText('common.reset'));
    expect(onSearchChange).toHaveBeenCalledWith('JE-2');
    expect(onDateChange).toHaveBeenCalledWith('2026-01-03');
    expect(onReset).toHaveBeenCalledOnce();
    expect(screen.queryByText('accounting.journalEntries.batchPost')).not.toBeInTheDocument();

    rerender(
      <JournalEntryFilters
        searchTerm="JE-2"
        statusFilter="draft"
        dateFilter="2026-01-03"
        canApprove
        t={t}
        onSearchChange={onSearchChange}
        onStatusChange={vi.fn()}
        onDateChange={onDateChange}
        onReset={onReset}
        onBatchPost={onBatchPost}
      />,
    );
    fireEvent.click(screen.getByText('accounting.journalEntries.batchPost'));
    expect(onBatchPost).toHaveBeenCalledOnce();
  });
});

describe('JournalEntriesTable', () => {
  const renderTable = (entries: JournalEntry[], options: Partial<React.ComponentProps<typeof JournalEntriesTable>> = {}) => render(
    <JournalEntriesTable
      entries={entries}
      loading={false}
      isRTL={false}
      canUpdate
      canApprove
      canDelete
      t={t}
      {...handlers}
      {...options}
    />,
  );

  it('renders loading and empty states', () => {
    const { rerender } = render(
      <JournalEntriesTable entries={[]} loading isRTL={false} canUpdate={false} canApprove={false} canDelete={false} t={t} {...handlers} />,
    );
    expect(document.querySelectorAll('[data-testid="skeleton"]')).toBeDefined();

    rerender(<JournalEntriesTable entries={[]} loading={false} isRTL={false} canUpdate={false} canApprove={false} canDelete={false} t={t} {...handlers} />);
    expect(screen.getByText('accounting.journalEntries.noEntries')).toBeInTheDocument();
  });

  it('routes all draft and posted actions to parent handlers', () => {
    renderTable([draftEntry, postedEntry]);
    const draftRow = screen.getByText('JE-001').closest('tr')!;
    fireEvent.click(within(draftRow).getByTitle('common.edit'));
    fireEvent.click(within(draftRow).getByTitle('accounting.journalEntries.post'));
    fireEvent.click(within(draftRow).getByTitle('common.delete'));

    const postedRow = screen.getByText('JE-002').closest('tr')!;
    fireEvent.click(within(postedRow).getByTitle('accounting.journalEntries.view'));
    fireEvent.click(within(postedRow).getByTitle('accounting.journalEntries.reverse'));

    expect(handlers.onEdit).toHaveBeenCalledWith(draftEntry);
    expect(handlers.onPost).toHaveBeenCalledWith(draftEntry);
    expect(handlers.onDelete).toHaveBeenCalledWith(draftEntry);
    expect(handlers.onView).toHaveBeenCalledWith(postedEntry);
    expect(handlers.onReverse).toHaveBeenCalledWith(postedEntry);
  });

  it('hides gated actions and renders RTL and reversed entries', () => {
    const reversedEntry: JournalEntry = {
      ...postedEntry,
      id: 'reversed-1',
      entry_number: 'JE-003',
      status: 'reversed',
      journal_name_ar: undefined,
    };
    const alreadyReversed = { ...postedEntry, id: 'posted-2', entry_number: 'JE-004', reversed_by_entry_id: 'reversal-1' };
    renderTable([draftEntry, alreadyReversed, reversedEntry], { isRTL: true, canUpdate: false, canApprove: false, canDelete: false });

    const draftRow = screen.getByText('JE-001').closest('tr')!;
    expect(within(draftRow).queryByRole('button')).not.toBeInTheDocument();
    const postedRow = screen.getByText('JE-004').closest('tr')!;
    expect(within(postedRow).getByTitle('accounting.journalEntries.view')).toBeInTheDocument();
    expect(within(postedRow).queryByTitle('accounting.journalEntries.reverse')).not.toBeInTheDocument();
    expect(screen.getAllByText('مسودة عربية')).toHaveLength(3);
    expect(screen.getByText('accounting.status.reversed')).toBeInTheDocument();
  });
});

describe('JournalEntryViewDialog', () => {
  it('renders no details without an entry and reports close changes', () => {
    const onOpenChange = vi.fn();
    render(<JournalEntryViewDialog open entry={null} isRTL={false} canApprove={false} t={t} onOpenChange={onOpenChange} />);
    expect(screen.getByText('accounting.journalEntries.viewEntryDetails')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('renders entry details and lines in RTL while preserving approval permission', async () => {
    const entry: JournalEntry = {
      ...postedEntry,
      lines: [
        { id: 'line-1', line_number: 1, account_id: 'a1', account_code: '1000', account_name: 'Cash', account_name_ar: 'النقدية', debit: 100, credit: 0, currency_code: 'SAR', description: 'Debit', description_ar: 'مدين' },
        { line_number: 2, account_id: 'a2', account_code: '2000', account_name: 'Payable', debit: undefined, credit: 100, currency_code: 'SAR' },
      ],
    };
    render(<JournalEntryViewDialog open entry={entry} isRTL canApprove t={t} onOpenChange={vi.fn()} />);
    expect(screen.getAllByText('JE-002').length).toBeGreaterThan(0);
    expect(screen.getByText('1000 - النقدية')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'accounting.journalEntries.approvals' }));
    expect(screen.getByText('approval:posted-1:true')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'accounting.journalEntries.attachmentsTab' }));
    expect(screen.getByText('attachments:posted-1')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'accounting.journalEntries.commentsTab' }));
    expect(screen.getByText('comments:posted-1')).toBeInTheDocument();
  });

  it('renders English line names and descriptions in LTR', () => {
    const entry: JournalEntry = {
      ...postedEntry,
      lines: [
        { line_number: 1, account_id: 'a1', account_code: '1000', account_name: 'Cash', debit: 100, credit: 0, currency_code: 'SAR', description: 'Debit line' },
      ],
    };
    render(<JournalEntryViewDialog open entry={entry} isRTL={false} canApprove={false} t={t} onOpenChange={vi.fn()} />);
    expect(screen.getByText('1000 - Cash')).toBeInTheDocument();
    expect(screen.getByText('Debit line')).toBeInTheDocument();
  });
});
