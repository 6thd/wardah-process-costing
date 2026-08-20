import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  AccountTreeItem,
  accountMatchesFilters,
  hasMatchingAccount,
  type AccountTreeItemProps,
  type AccountTreeNode,
} from '../components/AccountTreeItem';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const child: AccountTreeNode = {
  id: 'child-1',
  code: '1100',
  name: 'Petty Cash',
  name_ar: 'العهد النقدية',
  name_en: 'Petty Cash',
  category: 'ASSET',
  normal_balance: 'Debit',
  allow_posting: true,
  is_active: true,
  org_id: 'org-1',
  children: [],
};

const account: AccountTreeNode = {
  id: 'account-1',
  code: '1000',
  name: 'Cash',
  name_ar: 'النقدية',
  name_en: 'Cash',
  category: 'ASSET',
  normal_balance: 'Debit',
  allow_posting: false,
  is_active: true,
  org_id: 'org-1',
  children: [child],
};

function createProps(overrides: Partial<AccountTreeItemProps> = {}): AccountTreeItemProps {
  return {
    account,
    level: 0,
    isRTL: false,
    expandedNodes: new Set<string>(),
    onToggleNode: vi.fn(),
    onOpenModal: vi.fn(),
    onDeleteAccount: vi.fn(),
    searchTerm: '',
    categoryFilter: 'all',
    showInactiveAccounts: false,
    canCreate: false,
    canEdit: false,
    canDelete: false,
    ...overrides,
  };
}

describe('general-ledger account tree filters', () => {
  it('matches search, category, and active filters with the original AND semantics', () => {
    expect(accountMatchesFilters(account, {
      searchTerm: 'cash',
      categoryFilter: 'ASSET',
      showInactiveAccounts: false,
    })).toBe(true);
    expect(accountMatchesFilters({ ...account, is_active: false }, {
      searchTerm: '',
      categoryFilter: 'LIABILITY',
      showInactiveAccounts: false,
    })).toBe(false);
  });

  it('keeps a parent visible when only a descendant matches', () => {
    expect(hasMatchingAccount(account, {
      searchTerm: 'petty',
      categoryFilter: 'all',
      showInactiveAccounts: false,
    })).toBe(true);
  });

  it('returns false for a leaf with no matching filters', () => {
    expect(hasMatchingAccount({ ...child, children: undefined }, {
      searchTerm: 'missing',
      categoryFilter: 'all',
      showInactiveAccounts: false,
    })).toBe(false);
  });
});

describe('AccountTreeItem', () => {
  it('renders the localized identity and status badges', () => {
    render(<AccountTreeItem {...createProps({ isRTL: true })} />);

    expect(screen.getByText('النقدية')).toBeInTheDocument();
    expect(screen.getByText('gl.asset')).toBeInTheDocument();
    expect(screen.getByText('gl.debitShort')).toBeInTheDocument();
  });

  it('renders a matching descendant only after its parent is expanded', () => {
    render(<AccountTreeItem {...createProps({
      expandedNodes: new Set(['1000']),
      searchTerm: 'petty',
    })} />);

    expect(screen.getByText('Cash')).toBeInTheDocument();
    expect(screen.getByText('Petty Cash')).toBeInTheDocument();
  });

  it('hides a tree with no matching account or descendant', () => {
    const { container } = render(<AccountTreeItem {...createProps({ searchTerm: 'missing' })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('preserves create, edit, and delete permission gates and callbacks', async () => {
    const onOpenModal = vi.fn();
    const onDeleteAccount = vi.fn();
    render(<AccountTreeItem {...createProps({
      canCreate: true,
      canEdit: true,
      canDelete: true,
      onOpenModal,
      onDeleteAccount,
    })} />);

    await userEvent.click(screen.getByTitle('gl.addSubAccount'));
    await userEvent.click(screen.getByTitle('gl.editAccountBtn'));
    await userEvent.click(screen.getByTitle('gl.deleteAccountBtn'));

    expect(onOpenModal).toHaveBeenNthCalledWith(1, 'add', undefined, account);
    expect(onOpenModal).toHaveBeenNthCalledWith(2, 'edit', account);
    expect(onDeleteAccount).toHaveBeenCalledWith(account);
  });

  it('hides every action without its exact permission', () => {
    render(<AccountTreeItem {...createProps()} />);
    expect(screen.queryByTitle('gl.addSubAccount')).not.toBeInTheDocument();
    expect(screen.queryByTitle('gl.editAccountBtn')).not.toBeInTheDocument();
    expect(screen.queryByTitle('gl.deleteAccountBtn')).not.toBeInTheDocument();
  });

  it('toggles a parent while a leaf toggle stays disabled', async () => {
    const onToggleNode = vi.fn();
    const { rerender } = render(<AccountTreeItem {...createProps({ onToggleNode })} />);
    await userEvent.click(screen.getByRole('button'));
    expect(onToggleNode).toHaveBeenCalledWith('1000');

    rerender(<AccountTreeItem {...createProps({ account: child, onToggleNode })} />);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('renders inactive, postable, credit, and unknown-category fallbacks', () => {
    render(<AccountTreeItem {...createProps({
      account: {
        ...child,
        category: 'OTHER',
        normal_balance: 'Credit',
        is_active: false,
      },
      showInactiveAccounts: true,
    })} />);

    expect(screen.getByText('OTHER')).toBeInTheDocument();
    expect(screen.getByText('gl.creditShort')).toBeInTheDocument();
    expect(screen.getByText('gl.postable')).toBeInTheDocument();
    expect(screen.getByText('common.inactive')).toBeInTheDocument();
  });

  it('falls back to the base name in both directions and tolerates a missing category', () => {
    const fallbackAccount = {
      ...child,
      name: 'Fallback Name',
      name_ar: undefined,
      name_en: undefined,
      category: undefined,
    };
    render(
      <>
        <AccountTreeItem {...createProps({ account: fallbackAccount, isRTL: true })} />
        <AccountTreeItem {...createProps({ account: fallbackAccount, isRTL: false })} />
      </>,
    );

    expect(screen.getAllByText('Fallback Name')).toHaveLength(2);
  });
});
