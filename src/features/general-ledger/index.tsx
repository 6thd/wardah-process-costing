import { Routes, Route, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
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
import { usePermissions } from '@/hooks/usePermissions';
import { AccountTreeItem } from './components/AccountTreeItem';
import { saveGeneralLedgerAccount } from './helpers/saveAccount';
import {
  Plus,
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

function ChartOfAccounts() {
    const { t, i18n } = useTranslation();
    const isRTL = i18n.language === 'ar';
    const { hasPermissionKey } = usePermissions();
    const canCreateAccount = hasPermissionKey('general_ledger.chart_of_accounts.create');
    const canEditAccount = hasPermissionKey('general_ledger.chart_of_accounts.edit');
    const canDeleteAccount = hasPermissionKey('general_ledger.chart_of_accounts.delete');
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
        // دفاع داخل الـhandler، لا اعتمادًا فقط على إخفاء الزر: create/update
        // لا تُستدعيان بلا المفتاح الدقيق للفعل المطلوب فعليًا (create مقابل edit).
        if (modalType === 'edit' ? !canEditAccount : !canCreateAccount) {
            toast.error(modalType === 'edit' ? 'لا تملك صلاحية تعديل الحسابات' : 'لا تملك صلاحية إنشاء حسابات');
            return;
        }
        try {
            const outcome = await saveGeneralLedgerAccount(
                {
                    formData,
                    modalType,
                    selectedAccount,
                    t: (key, options) => t(key, options) as string,
                },
                {
                    getEffectiveTenantId,
                    checkAccountCodeExists,
                    createGLAccount,
                    updateGLAccount,
                },
            );
            if (outcome.status === 'rejected') {
                toast.error(outcome.message);
                return;
            }
            toast.success(outcome.message);

            handleCloseModal();
            await loadAccounts();
        } catch (err: any) {
            console.error('Error saving account:', err);
            toast.error(t('gl.saveFailed', { error: err.message }));
        }
    };

    const handleDeleteAccount = async (account: GLAccount) => {
        if (!canDeleteAccount) {
            toast.error('لا تملك صلاحية حذف الحسابات');
            return;
        }
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
                    {canCreateAccount && (
                        <Button onClick={() => handleOpenModal('add')} size="sm">
                            <Plus className="me-2 h-4 w-4"/>
                            {t('gl.addAccount')}
                        </Button>
                    )}
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
                            canCreate={canCreateAccount}
                            canEdit={canEditAccount}
                            canDelete={canDeleteAccount}
                        />
                    ))
                 ) : (
                     <EmptyState title={t('gl.noAccounts')} description={t('gl.noAccountsDesc')} />
                 )}
            </div>

            {/* لا يُفتَح النموذج بلا صلاحية الفعل الفعلي (create مقابل edit) —
                حتى لو تغيّر modalType داخليًا من قبل بعد سحب صلاحية أثناء الجلسة. */}
            <AccountFormModal
                isOpen={isModalOpen && (modalType === 'edit' ? canEditAccount : canCreateAccount)}
                onClose={handleCloseModal}
                onSave={handleSaveAccount}
                account={selectedAccount}
                parentAccount={parentAccount}
            />
        </div>
    );
}
