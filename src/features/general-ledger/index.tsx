import { Routes, Route, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import {
    GLAccount,
    getAllGLAccounts,
    getEffectiveTenantId,
    createGLAccount,
    updateGLAccount,
    deleteGLAccount,
    checkAccountCodeExists
} from '@/lib/supabase';
import { toast } from 'sonner';
// P4-D2: xlsx/jspdf تُحمَّلان كسولاً عند التصدير فقط
import { loadXLSX, loadJsPDF } from '@/lib/export-libs';
import { AccountStatement } from '@/features/accounting/account-statement';
import {
  Plus,
  Pencil,
  Trash2,
  ChevronRight,
  ChevronDown,
  FileDown,
  Search,
  Filter,
  Maximize2,
  Minimize2
} from 'lucide-react';

// Main Module Router
export function GeneralLedgerModule() {
  return (
    <Routes>
      <Route path="/accounts" element={<ChartOfAccounts />} />
      <Route path="/account-statement" element={<AccountStatement />} />
      {/* Other routes can be added here */}
      <Route path="*" element={<Navigate to="/general-ledger/accounts" replace />} />
    </Routes>
  );
}

// Account Form Modal Component
function AccountFormModal({ isOpen, onClose, onSave, account, parentAccount }: { readonly isOpen: boolean, readonly onClose: () => void, readonly onSave: (data: Partial<GLAccount>) => void, readonly account?: GLAccount | null, readonly parentAccount?: GLAccount | null }) {
    const { t, i18n } = useTranslation();
    const isRTL = i18n.language === 'ar';
    const [formData, setFormData] = useState<Partial<GLAccount>>({});

    useEffect(() => {
        if (isOpen) {
            if (account) {
                setFormData(account);
            } else {
                setFormData({
                    code: '',
                    name: '',
                    name_ar: '',
                    category: parentAccount?.category || 'ASSET',
                    normal_balance: parentAccount?.normal_balance || 'Debit',
                    allow_posting: true,
                    is_active: true,
                    parent_code: parentAccount?.code || undefined,
                });
            }
        }
    }, [isOpen, account, parentAccount]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value, type } = e.target;
        const checked = (e.target as HTMLInputElement).checked;
        setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    };

    const handleSelectChange = (name: string, value: string | boolean) => {
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave(formData);
    };

    if (!isOpen) return null;

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-[425px]" dir={isRTL ? "rtl" : "ltr"}>
                <DialogHeader>
                    <DialogTitle>{account ? t('gl.editAccount') : t('gl.addNewAccount')}</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4 py-4">
                    <Input name="code" value={formData.code || ''} onChange={handleInputChange} placeholder={t('gl.accountCode')} required />
                    <Input name="name" value={formData.name || ''} onChange={handleInputChange} placeholder={t('gl.accountNameEn')} required />
                    <Input name="name_ar" value={formData.name_ar || ''} onChange={handleInputChange} placeholder={t('gl.accountNameAr')} />
                    <Select name="category" value={formData.category || ''} onValueChange={(value) => handleSelectChange('category', value)}>
                        <SelectTrigger><SelectValue placeholder={t('gl.accountType')} /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="ASSET">{t('gl.assets')}</SelectItem>
                            <SelectItem value="LIABILITY">{t('gl.liabilities')}</SelectItem>
                            <SelectItem value="EQUITY">{t('gl.equity')}</SelectItem>
                            <SelectItem value="REVENUE">{t('gl.revenue')}</SelectItem>
                            <SelectItem value="EXPENSE">{t('gl.expenses')}</SelectItem>
                        </SelectContent>
                    </Select>
                    <Select name="normal_balance" value={formData.normal_balance || ''} onValueChange={(value) => handleSelectChange('normal_balance', value)}>
                        <SelectTrigger><SelectValue placeholder={t('gl.normalBalance')} /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="Debit">{t('gl.debit')}</SelectItem>
                            <SelectItem value="Credit">{t('gl.credit')}</SelectItem>
                        </SelectContent>
                    </Select>
                    <div className="flex items-center space-x-2 rtl:space-x-reverse">
                        <Checkbox id="allow_posting" name="allow_posting" checked={!!formData.allow_posting} onCheckedChange={(checked) => handleSelectChange('allow_posting', !!checked)} />
                        <label htmlFor="allow_posting" className="text-sm cursor-pointer">{t('gl.allowPosting')}</label>
                    </div>
                     <div className="flex items-center space-x-2 rtl:space-x-reverse">
                        <Checkbox id="is_active" name="is_active" checked={!!formData.is_active} onCheckedChange={(checked) => handleSelectChange('is_active', !!checked)} />
                        <label htmlFor="is_active" className="text-sm cursor-pointer">{t('common.active')}</label>
                    </div>
                    <DialogFooter>
                        <DialogClose asChild><Button type="button" variant="outline">{t('common.cancel')}</Button></DialogClose>
                        <Button type="submit">{t('common.save')}</Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

// New AccountTreeItem Component for Collapsible Tree with Enhanced Design
const AccountTreeItem = ({ account, level, isRTL, expandedNodes, onToggleNode, onOpenModal, onDeleteAccount, searchTerm, categoryFilter, showInactiveAccounts }: {
  account: any,
  level: number,
  isRTL: boolean,
  expandedNodes: Set<string>,
  onToggleNode: (code: string) => void,
  onOpenModal: (type: 'add' | 'edit', account?: any, parent?: any) => void,
  onDeleteAccount: (account: any) => void,
  searchTerm: string,
  categoryFilter: string,
  showInactiveAccounts: boolean
}) => {
    const { t } = useTranslation();
    const isExpanded = expandedNodes.has(account.code);
    const hasChildren = account.children && account.children.length > 0;

    // Helper function to check if account or any child matches filters
    const matchesFilters = (acc: any): boolean => {
        // Check search term
        const matchesSearch = !searchTerm ||
            acc.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (acc.name && acc.name.toLowerCase().includes(searchTerm.toLowerCase())) ||
            (acc.name_ar && acc.name_ar.toLowerCase().includes(searchTerm.toLowerCase()));

        // Check category filter
        const matchesCategory = categoryFilter === 'all' || acc.category === categoryFilter;

        // Check active status
        const matchesActive = showInactiveAccounts || acc.is_active;

        return matchesSearch && matchesCategory && matchesActive;
    };

    // Check if this account or any child matches
    const hasMatchingChild = (acc: any): boolean => {
        if (matchesFilters(acc)) return true;
        if (acc.children && acc.children.length > 0) {
            return acc.children.some((child: any) => hasMatchingChild(child));
        }
        return false;
    };

    if (!hasMatchingChild(account)) {
        return null;
    }

    const getCategoryBadge = (category: string) => {
        const badges: any = {
            'ASSET': { label: t('gl.asset'), variant: 'default', className: 'bg-blue-100 text-blue-800 border-blue-200' },
            'LIABILITY': { label: t('gl.liability'), variant: 'secondary', className: 'bg-red-100 text-red-800 border-red-200' },
            'EQUITY': { label: t('gl.equity'), variant: 'outline', className: 'bg-purple-100 text-purple-800 border-purple-200' },
            'REVENUE': { label: t('gl.revenue'), variant: 'default', className: 'bg-green-100 text-green-800 border-green-200' },
            'EXPENSE': { label: t('gl.expense'), variant: 'destructive', className: 'bg-orange-100 text-orange-800 border-orange-200' }
        };
        const badge = badges[category] || { label: category, variant: 'outline', className: '' };
        return <Badge variant="outline" className={`text-xs ${badge.className}`}>{badge.label}</Badge>;
    };

    const getNormalBalanceBadge = (normalBalance: string) => {
        if (normalBalance === 'Debit') {
            return <Badge variant="outline" className="text-xs bg-sky-50 text-sky-700 border-sky-200">{t('gl.debitShort')}</Badge>;
        } else {
            return <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200">{t('gl.creditShort')}</Badge>;
        }
    };

    return (
        <div key={account.code}>
            <div
                className={`flex justify-between items-center transition-all duration-150 group border-b border-border/40 hover:bg-accent/50 hover:shadow-sm ${
                    !account.is_active ? 'opacity-50' : ''
                } ${
                    level === 0 ? 'font-semibold' : ''
                }`}
                style={{
                    paddingRight: isRTL ? `${level * 24 + 12}px` : '12px',
                    paddingLeft: isRTL ? '12px' : `${level * 24 + 12}px`,
                    paddingTop: '10px',
                    paddingBottom: '10px'
                }}
            >
                <div className="flex items-center gap-3 flex-1">
                    <button
                        type="button"
                        disabled={!hasChildren}
                        className="cursor-pointer flex items-center hover:bg-accent/30 rounded-md p-1 transition-colors disabled:cursor-default disabled:opacity-50 border-0 bg-transparent"
                        onClick={() => hasChildren && onToggleNode(account.code)}
                    >
                        {hasChildren ? (
                            isExpanded ?
                                <ChevronDown className="h-4 w-4 text-primary" /> :
                                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        ) : (
                            <span className="w-4 h-4 flex items-center justify-center">
                                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40"></span>
                            </span>
                        )}
                    </button>

                    <div className="flex items-center gap-2 flex-1">
                        <code className={`text-sm font-mono px-2 py-0.5 rounded bg-muted/50 ${level === 0 ? 'font-bold' : ''}`}>
                            {account.code}
                        </code>
                        <span className={`${level === 0 ? 'text-base font-bold' : 'text-sm'} flex-1`}>
                            {isRTL ? (account.name_ar || account.name) : (account.name_en || account.name)}
                        </span>
                    </div>

                    <div className="flex items-center gap-2">
                        {getCategoryBadge(account.category)}
                        {getNormalBalanceBadge(account.normal_balance)}
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
                </div>

                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-4">
                    {!account.allow_posting && (
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
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 hover:bg-blue-100 hover:text-blue-700"
                        title={t('gl.editAccountBtn')}
                        onClick={() => onOpenModal('edit', account)}
                    >
                        <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 hover:bg-red-100 hover:text-red-700"
                        title={t('gl.deleteAccountBtn')}
                        onClick={() => onDeleteAccount(account)}
                    >
                        <Trash2 className="h-4 w-4" />
                    </Button>
                </div>
            </div>
            {isExpanded && hasChildren && (
                <div className="border-l-2 border-primary/20 ml-4">
                    {account.children.map((child: any) => (
                        <AccountTreeItem
                            key={child.code}
                            account={child}
                            level={level + 1}
                            isRTL={isRTL}
                            expandedNodes={expandedNodes}
                            onToggleNode={onToggleNode}
                            onOpenModal={onOpenModal}
                            onDeleteAccount={onDeleteAccount}
                            searchTerm={searchTerm}
                            categoryFilter={categoryFilter}
                            showInactiveAccounts={showInactiveAccounts}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

function ChartOfAccounts() {
    const { t, i18n } = useTranslation();
    const isRTL = i18n.language === 'ar';
    const [accounts, setAccounts] = useState<GLAccount[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

    // Enhanced state for advanced features
    const [searchTerm, setSearchTerm] = useState('');
    const [categoryFilter, setCategoryFilter] = useState('all');
    const [showInactiveAccounts, setShowInactiveAccounts] = useState(false);

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [modalType, setModalType] = useState<'add' | 'edit'>('add');
    const [selectedAccount, setSelectedAccount] = useState<GLAccount | null>(null);
    const [parentAccount, setParentAccount] = useState<GLAccount | null>(null);

    const loadAccounts = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await getAllGLAccounts();
            if (Array.isArray(result)) {
                setAccounts(result);
                if (result.length === 0) {
                    setError('لا توجد حسابات. قم بإضافة حساب جديد للبدء.');
                }
            } else {
                throw new Error('البيانات المستلمة غير صالحة.');
            }
        } catch (err: any) {
            console.error('Error loading accounts:', err);
            setError(err.message || 'خطأ في تحميل شجرة الحسابات.');
            setAccounts([]); // Clear accounts on error
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadAccounts();
    }, [loadAccounts]);

    const handleToggleNode = (code: string) => {
        setExpandedNodes(prev => {
            const newSet = new Set(prev);
            if (newSet.has(code)) {
                newSet.delete(code);
            } else {
                newSet.add(code);
            }
            return newSet;
        });
    };

    const handleOpenModal = (type: 'add' | 'edit', account?: GLAccount, parent?: GLAccount) => {
        setModalType(type);
        setSelectedAccount(account || null);
        setParentAccount(parent || null);
        setIsModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setSelectedAccount(null);
        setParentAccount(null);
    };

    const handleSaveAccount = async (formData: Partial<GLAccount>) => {
        try {
            const org_id = await getEffectiveTenantId();
            if (!org_id) throw new Error(t('gl.orgIdNotFound'));

            // Validate required fields
            if (!formData.code || !formData.name || !formData.category) {
                toast.error(t('gl.requiredFields'));
                return;
            }

            // Check for duplicate account code (only on create or if code changed)
            if (modalType === 'add' || (modalType === 'edit' && selectedAccount && formData.code !== selectedAccount.code)) {
                const codeExists = await checkAccountCodeExists(formData.code as string, org_id);
                if (codeExists) {
                    toast.error(t('gl.duplicateCode', { code: formData.code }));
                    return;
                }
            }

            // Convert category to account_type for CreateGLAccountInput
            const accountType = formData.category as 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE' | undefined;
            if (!accountType) {
                toast.error(t('gl.accountTypeRequired'));
                return;
            }

            if (modalType === 'edit' && selectedAccount) {
                // Update existing account - UpdateGLAccountInput needs { id, ...updates }
                const updateData: any = {
                    id: selectedAccount.id,
                    code: formData.code,
                    name: formData.name,
                    name_ar: formData.name_ar,
                    name_en: formData.name_en,
                    account_type: accountType,
                    parent_id: formData.parent_id || null,
                    is_active: formData.is_active,
                };
                const result = await updateGLAccount(updateData);
                if (result.success) {
                    toast.success(t('gl.updatedSuccess'));
                } else {
                    throw new Error(result.error || 'Update failed');
                }
            } else {
                // Create new account - CreateGLAccountInput needs account_type (required)
                const createData: any = {
                    code: formData.code as string,
                    name: formData.name as string,
                    name_ar: formData.name_ar,
                    name_en: formData.name_en,
                    account_type: accountType,
                    parent_id: formData.parent_id || null,
                    is_active: formData.is_active !== false,
                };
                const result = await createGLAccount(createData);
                if (result.success) {
                    toast.success(t('gl.createdSuccess'));
                } else {
                    throw new Error(result.error || 'Create failed');
                }
            }

            handleCloseModal();
            await loadAccounts();
        } catch (err: any) {
            console.error('Error saving account:', err);
            toast.error(t('gl.saveFailed', { error: err.message }));
        }
    };

    const handleDeleteAccount = async (account: GLAccount) => {
        const accountName = isRTL ? (account.name_ar || account.name) : (account.name_en || account.name);
        const confirmMessage = t('gl.deleteConfirm', { name: accountName });

        if (window.confirm(confirmMessage)) {
            try {
                const result = await deleteGLAccount(account.id);

                if (result.success) {
                    toast.success(t('gl.deletedSuccess'));
                    await loadAccounts();
                } else {
                    // Check if error indicates soft delete (has transactions)
                    if (result.error && result.error.includes('transactions')) {
                        toast.success(
                            t('gl.deactivatedSuccess'),
                            { description: t('gl.deactivatedDesc') }
                        );
                        await loadAccounts();
                    } else {
                        throw new Error(result.error || 'Delete failed');
                    }
                }
            } catch (err: any) {
                console.error('Error deleting account:', err);
                toast.error(t('gl.deleteFailed', { error: err.message }));
            }
        }
    };

    const buildTree = (list: GLAccount[]): any[] => {
        if (!list || list.length === 0) return [];
        const map = new Map<string, any>();
        const roots: any[] = [];
        list.forEach(acc => map.set(acc.code, { ...acc, children: [] }));
        list.forEach(acc => {
            if (acc.parent_code && map.has(acc.parent_code)) {
                const parent = map.get(acc.parent_code);
                const child = map.get(acc.code);
                if (parent && child && parent.code !== child.code) {
                    parent.children.push(child);
                }
            } else {
                roots.push(map.get(acc.code));
            }
        });
        const sortChildren = (nodes: any[]) => {
            nodes.sort((a, b) => a.code.localeCompare(b.code));
            nodes.forEach(node => {
                if (node.children.length > 0) sortChildren(node.children);
            });
        };
        sortChildren(roots);
        return roots;
    };

    const flattenForExport = (nodes: any[], level = 0) => {
        let result: any[] = [];
        for (const node of nodes) {
            result.push({ level, ...node });
            if (node.children) {
                result = result.concat(flattenForExport(node.children, level + 1));
            }
        }
        return result;
    };

    const handleExportToExcel = async () => {
        const XLSX = await loadXLSX();
        const tree = buildTree(accounts);
        const flatData = flattenForExport(tree);
        const worksheetData = flatData.map(item => ({
            'المستوى': ' '.repeat(item.level * 2) + item.code,
            'الاسم العربي': item.name_ar || item.name,
            'الاسم الانجليزي': item.name_en || item.name,
            'النوع': item.category,
        }));
        const worksheet = XLSX.utils.json_to_sheet(worksheetData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Chart of Accounts");
        XLSX.writeFile(workbook, "ChartOfAccounts.xlsx");
    };

    const handleExportToPdf = async () => {
        const jsPDF = await loadJsPDF();
        const doc = new jsPDF();
        const tree = buildTree(accounts);
        const flatData = flattenForExport(tree);
        const accountNameField = isRTL ? 'name_ar' : 'name_en';
        const tableData = flatData.map(item => [
            ' '.repeat(item.level * 2) + item.code,
            item[accountNameField] || item.name, // Fallback to name if translation is not available
            item.category,
        ]);

        (doc as any).autoTable({
            head: [[t('gl.pdfAccountCode'), t('gl.pdfAccountName'), t('gl.pdfCategory')]],
            body: tableData,
            styles: { font: 'Arial', halign: isRTL ? 'right' : 'left' },
            headStyles: { halign: isRTL ? 'right' : 'left' },
        });

        doc.save('ChartOfAccounts.pdf');
    };

    const accountTree = buildTree(accounts);

    // Function to expand/collapse all nodes
    const handleExpandAll = () => {
        const allCodes = new Set<string>();
        const collectCodes = (nodes: any[]) => {
            nodes.forEach(node => {
                if (node.children && node.children.length > 0) {
                    allCodes.add(node.code);
                    collectCodes(node.children);
                }
            });
        };
        collectCodes(accountTree);
        setExpandedNodes(allCodes);
    };

    const handleCollapseAll = () => {
        setExpandedNodes(new Set());
    };

    // Calculate statistics
    const stats = {
        total: accounts.length,
        active: accounts.filter(a => a.is_active).length,
        postable: accounts.filter(a => a.allow_posting).length,
        byCategory: {
            ASSET: accounts.filter(a => a.category === 'ASSET').length,
            LIABILITY: accounts.filter(a => a.category === 'LIABILITY').length,
            EQUITY: accounts.filter(a => a.category === 'EQUITY').length,
            REVENUE: accounts.filter(a => a.category === 'REVENUE').length,
            EXPENSE: accounts.filter(a => a.category === 'EXPENSE').length,
        }
    };

    return (
        <div className="space-y-4 p-4 md:p-6" dir={isRTL ? "rtl" : "ltr"}>
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
                        {t('gl.chartOfAccounts')}
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        {t('gl.statsDesc', { total: stats.total, active: stats.active, postable: stats.postable })}
                    </p>
                </div>
                <div className="flex gap-2">
                    <Button onClick={handleExportToExcel} variant="outline" size="sm">
                        <FileDown className="me-2 h-4 w-4"/>
                        Excel
                    </Button>
                    <Button onClick={handleExportToPdf} variant="outline" size="sm">
                        <FileDown className="me-2 h-4 w-4"/>
                        PDF
                    </Button>
                    <Button onClick={() => handleOpenModal('add')} size="sm">
                        <Plus className="me-2 h-4 w-4"/>
                        {t('gl.addAccount')}
                    </Button>
                </div>
            </div>

            {/* Advanced Filters */}
            <div className="bg-card rounded-lg border p-4 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="md:col-span-2">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                            <Input
                                placeholder={t('gl.searchPlaceholder')}
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="pl-10"
                            />
                        </div>
                    </div>

                    <div>
                        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                            <SelectTrigger>
                                <Filter className="h-4 w-4 mr-2" />
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">{t('gl.allTypes')}</SelectItem>
                                <SelectItem value="ASSET">{t('gl.assets')} ({stats.byCategory.ASSET})</SelectItem>
                                <SelectItem value="LIABILITY">{t('gl.liabilities')} ({stats.byCategory.LIABILITY})</SelectItem>
                                <SelectItem value="EQUITY">{t('gl.equity')} ({stats.byCategory.EQUITY})</SelectItem>
                                <SelectItem value="REVENUE">{t('gl.revenue')} ({stats.byCategory.REVENUE})</SelectItem>
                                <SelectItem value="EXPENSE">{t('gl.expenses')} ({stats.byCategory.EXPENSE})</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="flex gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleExpandAll}
                            className="flex-1"
                        >
                            <Maximize2 className="h-4 w-4 mr-2" />
                            {t('gl.expandAll')}
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleCollapseAll}
                            className="flex-1"
                        >
                            <Minimize2 className="h-4 w-4 mr-2" />
                            {t('gl.collapseAll')}
                        </Button>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                        <Checkbox
                            id="show_inactive"
                            checked={showInactiveAccounts}
                            onCheckedChange={(checked) => setShowInactiveAccounts(!!checked)}
                        />
                        <label htmlFor="show_inactive" className="text-sm cursor-pointer">
                            {t('gl.showInactive')}
                        </label>
                    </div>

                    {(searchTerm || categoryFilter !== 'all' || showInactiveAccounts) && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                                setSearchTerm('');
                                setCategoryFilter('all');
                                setShowInactiveAccounts(false);
                            }}
                        >
                            {t('gl.resetFilters')}
                        </Button>
                    )}
                </div>
            </div>

            {/* Account Tree */}
            <div className="bg-card rounded-lg border shadow-sm">
                 {loading ? (
                     <div className="p-8 text-center">
                         <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent"></div>
                         <p className="mt-4 text-muted-foreground">{t('common.loading')}</p>
                     </div>
                 ) : error ? (
                     <div className="p-8 text-center text-red-500">{error}</div>
                 ) : accountTree.length > 0 ? (
                    accountTree.map(account => (
                        <AccountTreeItem
                            key={account.code}
                            account={account}
                            level={0}
                            isRTL={isRTL}
                            expandedNodes={expandedNodes}
                            onToggleNode={handleToggleNode}
                            onOpenModal={handleOpenModal}
                            onDeleteAccount={handleDeleteAccount}
                            searchTerm={searchTerm}
                            categoryFilter={categoryFilter}
                            showInactiveAccounts={showInactiveAccounts}
                        />
                    ))
                 ) : (
                     <EmptyState title={t('gl.noAccounts')} description={t('gl.noAccountsDesc')} />
                 )}
            </div>

            <AccountFormModal
                isOpen={isModalOpen}
                onClose={handleCloseModal}
                onSave={handleSaveAccount}
                account={selectedAccount}
                parentAccount={parentAccount}
            />
        </div>
    );
}
