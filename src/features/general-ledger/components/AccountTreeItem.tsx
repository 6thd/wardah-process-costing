import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { GLAccount } from '@/lib/supabase';
import { ChevronDown, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react';

export interface AccountTreeNode extends GLAccount {
  children?: AccountTreeNode[];
}

export interface AccountTreeItemProps {
  account: AccountTreeNode;
  level: number;
  isRTL: boolean;
  expandedNodes: Set<string>;
  onToggleNode: (code: string) => void;
  onOpenModal: (type: 'add' | 'edit', account?: GLAccount, parent?: GLAccount) => void;
  onDeleteAccount: (account: GLAccount) => void;
  searchTerm: string;
  categoryFilter: string;
  showInactiveAccounts: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

interface AccountFilter {
  searchTerm: string;
  categoryFilter: string;
  showInactiveAccounts: boolean;
}

export function accountMatchesFilters(account: AccountTreeNode, filter: AccountFilter) {
  const normalizedSearch = filter.searchTerm.toLowerCase();
  const matchesSearch = !filter.searchTerm
    || account.code.toLowerCase().includes(normalizedSearch)
    || Boolean(account.name && account.name.toLowerCase().includes(normalizedSearch))
    || Boolean(account.name_ar && account.name_ar.toLowerCase().includes(normalizedSearch));
  const matchesCategory = filter.categoryFilter === 'all'
    || account.category === filter.categoryFilter;
  const matchesActive = filter.showInactiveAccounts || account.is_active;

  return matchesSearch && matchesCategory && matchesActive;
}

export function hasMatchingAccount(account: AccountTreeNode, filter: AccountFilter): boolean {
  if (accountMatchesFilters(account, filter)) return true;
  return account.children?.some((child) => hasMatchingAccount(child, filter)) ?? false;
}

const CATEGORY_CLASS_NAMES: Record<string, string> = {
  ASSET: 'bg-blue-100 text-blue-800 border-blue-200',
  LIABILITY: 'bg-red-100 text-red-800 border-red-200',
  EQUITY: 'bg-purple-100 text-purple-800 border-purple-200',
  REVENUE: 'bg-green-100 text-green-800 border-green-200',
  EXPENSE: 'bg-orange-100 text-orange-800 border-orange-200',
};

const CATEGORY_LABEL_KEYS: Record<string, string> = {
  ASSET: 'gl.asset',
  LIABILITY: 'gl.liability',
  EQUITY: 'gl.equity',
  REVENUE: 'gl.revenue',
  EXPENSE: 'gl.expense',
};

function CategoryBadge({ category }: { readonly category?: string }) {
  const { t } = useTranslation();
  const categoryValue = category || '';
  const labelKey = CATEGORY_LABEL_KEYS[categoryValue];
  const label = labelKey ? t(labelKey) : categoryValue;

  return (
    <Badge
      variant="outline"
      className={`text-xs ${CATEGORY_CLASS_NAMES[categoryValue] || ''}`}
    >
      {label}
    </Badge>
  );
}

function NormalBalanceBadge({ normalBalance }: { readonly normalBalance?: string }) {
  const { t } = useTranslation();
  const isDebit = normalBalance === 'Debit';
  const className = isDebit
    ? 'text-xs bg-sky-50 text-sky-700 border-sky-200'
    : 'text-xs bg-amber-50 text-amber-700 border-amber-200';

  return (
    <Badge variant="outline" className={className}>
      {t(isDebit ? 'gl.debitShort' : 'gl.creditShort')}
    </Badge>
  );
}

function AccountBadges({ account }: { readonly account: AccountTreeNode }) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-2">
      <CategoryBadge category={account.category} />
      <NormalBalanceBadge normalBalance={account.normal_balance} />
      {account.allow_posting && (
        <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-200">
          {t('gl.postable')}
        </Badge>
      )}
      {!account.is_active && (
        <Badge variant="outline" className="text-xs bg-gray-100 text-gray-600 border-gray-300">
          {t('common.inactive')}
        </Badge>
      )}
    </div>
  );
}

function TreeToggle({
  accountCode,
  hasChildren,
  isExpanded,
  onToggleNode,
}: {
  readonly accountCode: string;
  readonly hasChildren: boolean;
  readonly isExpanded: boolean;
  readonly onToggleNode: (code: string) => void;
}) {
  let icon = (
    <span className="w-4 h-4 flex items-center justify-center">
      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />
    </span>
  );
  if (hasChildren) {
    icon = isExpanded
      ? <ChevronDown className="h-4 w-4 text-primary" />
      : <ChevronRight className="h-4 w-4 text-muted-foreground" />;
  }

  return (
    <button
      type="button"
      disabled={!hasChildren}
      className="cursor-pointer flex items-center hover:bg-accent/30 rounded-md p-1 transition-colors disabled:cursor-default disabled:opacity-50 border-0 bg-transparent"
      onClick={() => onToggleNode(accountCode)}
    >
      {icon}
    </button>
  );
}

function AccountIdentity({
  account,
  isRTL,
  level,
}: {
  readonly account: AccountTreeNode;
  readonly isRTL: boolean;
  readonly level: number;
}) {
  const codeClassName = level === 0 ? 'font-bold' : '';
  const nameClassName = level === 0 ? 'text-base font-bold' : 'text-sm';
  const displayName = isRTL
    ? (account.name_ar || account.name)
    : (account.name_en || account.name);

  return (
    <div className="flex items-center gap-2 flex-1">
      <code className={`text-sm font-mono px-2 py-0.5 rounded bg-muted/50 ${codeClassName}`}>
        {account.code}
      </code>
      <span className={`${nameClassName} flex-1`}>{displayName}</span>
    </div>
  );
}

function AccountActions({
  account,
  canCreate,
  canEdit,
  canDelete,
  onOpenModal,
  onDeleteAccount,
}: Pick<
  AccountTreeItemProps,
  'account' | 'canCreate' | 'canEdit' | 'canDelete' | 'onOpenModal' | 'onDeleteAccount'
>) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-4">
      {!account.allow_posting && canCreate && (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 hover:bg-primary/10 hover:text-primary"
          title={t('gl.addSubAccount')}
          onClick={() => onOpenModal('add', undefined, account)}
        >
          <Plus className="h-4 w-4" />
        </Button>
      )}
      {canEdit && (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 hover:bg-blue-100 hover:text-blue-700"
          title={t('gl.editAccountBtn')}
          onClick={() => onOpenModal('edit', account)}
        >
          <Pencil className="h-4 w-4" />
        </Button>
      )}
      {canDelete && (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 hover:bg-red-100 hover:text-red-700"
          title={t('gl.deleteAccountBtn')}
          onClick={() => onDeleteAccount(account)}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

function AccountChildren(props: AccountTreeItemProps & { readonly isExpanded: boolean }) {
  if (!props.isExpanded || !props.account.children?.length) return null;

  return (
    <div className="border-l-2 border-primary/20 ml-4">
      {props.account.children.map((child) => (
        <AccountTreeItem
          {...props}
          key={child.code}
          account={child}
          level={props.level + 1}
        />
      ))}
    </div>
  );
}

export function AccountTreeItem(props: AccountTreeItemProps) {
  const filter = {
    searchTerm: props.searchTerm,
    categoryFilter: props.categoryFilter,
    showInactiveAccounts: props.showInactiveAccounts,
  };
  if (!hasMatchingAccount(props.account, filter)) return null;

  const isExpanded = props.expandedNodes.has(props.account.code);
  const hasChildren = Boolean(props.account.children?.length);
  const rowClassName = [
    'flex justify-between items-center transition-all duration-150 group border-b border-border/40 hover:bg-accent/50 hover:shadow-sm',
    props.account.is_active ? '' : 'opacity-50',
    props.level === 0 ? 'font-semibold' : '',
  ].filter(Boolean).join(' ');
  const rowStyle = {
    paddingRight: props.isRTL ? `${props.level * 24 + 12}px` : '12px',
    paddingLeft: props.isRTL ? '12px' : `${props.level * 24 + 12}px`,
    paddingTop: '10px',
    paddingBottom: '10px',
  };

  return (
    <div>
      <div className={rowClassName} style={rowStyle}>
        <div className="flex items-center gap-3 flex-1">
          <TreeToggle
            accountCode={props.account.code}
            hasChildren={hasChildren}
            isExpanded={isExpanded}
            onToggleNode={props.onToggleNode}
          />
          <AccountIdentity account={props.account} isRTL={props.isRTL} level={props.level} />
          <AccountBadges account={props.account} />
        </div>
        <AccountActions
          account={props.account}
          canCreate={props.canCreate}
          canEdit={props.canEdit}
          canDelete={props.canDelete}
          onOpenModal={props.onOpenModal}
          onDeleteAccount={props.onDeleteAccount}
        />
      </div>
      <AccountChildren {...props} isExpanded={isExpanded} />
    </div>
  );
}
