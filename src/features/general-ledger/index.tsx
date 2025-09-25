import { Routes, Route, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { getSupabase, GLAccount, getAllGLAccounts, getEffectiveTenantId } from '@/lib/supabase';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import {
  Plus,
  Pencil,
  Trash2,
  ChevronRight,
  ChevronDown,
  FileDown
} from 'lucide-react';

// Main Module Router
export function GeneralLedgerModule() {
  return (
    <Routes>
      <Route path="/accounts" element={<ChartOfAccounts />} />
      {/* Other routes can be added here */}
      <Route path="*" element={<Navigate to="/general-ledger/accounts" replace />} />
    </Routes>
  );
}

// Account Form Modal Component
function AccountFormModal({ isOpen, onClose, onSave, account, parentAccount }: { isOpen: boolean, onClose: () => void, onSave: (data: Partial<GLAccount>) => void, account?: GLAccount | null, parentAccount?: GLAccount | null }) {
    const { i18n } = useTranslation();
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
                    <DialogTitle>{account ? 'تعديل حساب' : 'إضافة حساب جديد'}</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4 py-4">
                    <Input name="code" value={formData.code || ''} onChange={handleInputChange} placeholder="رمز الحساب" required />
                    <Input name="name" value={formData.name || ''} onChange={handleInputChange} placeholder="اسم الحساب (انجليزي)" required />
                    <Input name="name_ar" value={formData.name_ar || ''} onChange={handleInputChange} placeholder="اسم الحساب (عربي)" />
                    <Select name="category" value={formData.category} onValueChange={(value) => handleSelectChange('category', value)}>
                        <SelectTrigger><SelectValue placeholder="نوع الحساب" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="ASSET">الأصول</SelectItem>
                            <SelectItem value="LIABILITY">الخصوم</SelectItem>
                            <SelectItem value="EQUITY">حقوق الملكية</SelectItem>
                            <SelectItem value="REVENUE">الإيرادات</SelectItem>
                            <SelectItem value="EXPENSE">المصروفات</SelectItem>
                        </SelectContent>
                    </Select>
                    <Select name="normal_balance" value={formData.normal_balance} onValueChange={(value) => handleSelectChange('normal_balance', value)}>
                        <SelectTrigger><SelectValue placeholder="الرصيد الطبيعي" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="Debit">مدين</SelectItem>
                            <SelectItem value="Credit">دائن</SelectItem>
                        </SelectContent>
                    </Select>
                    <div className="flex items-center space-x-2">
                        <Checkbox id="allow_posting" name="allow_posting" checked={!!formData.allow_posting} onCheckedChange={(checked) => handleSelectChange('allow_posting', !!checked)} />
                        <label htmlFor="allow_posting">يقبل الترحيل</label>
                    </div>
                     <div className="flex items-center space-x-2">
                        <Checkbox id="is_active" name="is_active" checked={!!formData.is_active} onCheckedChange={(checked) => handleSelectChange('is_active', !!checked)} />
                        <label htmlFor="is_active">نشط</label>
                    </div>
                    <DialogFooter>
                        <DialogClose asChild><Button type="button" variant="outline">إلغاء</Button></DialogClose>
                        <Button type="submit">حفظ</Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

// New AccountTreeItem Component for Collapsible Tree
const AccountTreeItem = ({ account, level, isRTL, expandedNodes, onToggleNode, onOpenModal, onDeleteAccount }: { account: any, level: number, isRTL: boolean, expandedNodes: Set<string>, onToggleNode: (code: string) => void, onOpenModal: (type: 'add' | 'edit', account?: any, parent?: any) => void, onDeleteAccount: (account: any) => void }) => {
    const [isHovered, setIsHovered] = useState(false);
    const isExpanded = expandedNodes.has(account.code);
    const hasChildren = account.children && account.children.length > 0;

    return (
        <div key={account.code}>
            <div
                className="flex justify-between items-center hover:bg-accent transition-colors group text-sm"
                style={{ paddingRight: isRTL ? `${level * 24 + 8}px` : '8px', paddingLeft: isRTL ? '8px' : `${level * 24 + 8}px` }}
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
            >
                <div className="flex items-center gap-1 flex-1 cursor-pointer" onClick={() => hasChildren && onToggleNode(account.code)}>
                    {hasChildren ? (
                        isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />
                    ) : (
                        <span className="w-4"></span> // Placeholder for alignment
                    )}
                    <p className="font-medium">{account.code} - {account.name_ar || account.name}</p>
                </div>
                <div className="flex items-center gap-2 p-2">
                    {isHovered && (
                        <div className="flex items-center gap-1">
                           {!account.allow_posting && (
                                <Button variant="ghost" size="icon" title="إضافة حساب فرعي" onClick={() => onOpenModal('add', undefined, account)}><Plus className="h-4 w-4" /></Button>
                            )}
                            <Button variant="ghost" size="icon" title="تعديل الحساب" onClick={() => onOpenModal('edit', account)}><Pencil className="h-4 w-4" /></Button>
                            <Button variant="ghost" size="icon" title="حذف الحساب" onClick={() => onDeleteAccount(account)}><Trash2 className="h-4 w-4 text-red-500" /></Button>
                        </div>
                    )}
                </div>
            </div>
            {isExpanded && hasChildren && (
                <div>
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
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

function ChartOfAccounts() {
    const { i18n } = useTranslation();
    const isRTL = i18n.language === 'ar';
    const [accounts, setAccounts] = useState<GLAccount[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

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
            const supabase = await getSupabase();
            const org_id = await getEffectiveTenantId();
            if (!org_id) throw new Error("Organization ID not found");

            const dataToSave = { ...formData, org_id };
            const { error } = modalType === 'edit' && selectedAccount
                ? await supabase.from('gl_accounts').update(dataToSave).eq('id', selectedAccount.id)
                : await supabase.from('gl_accounts').insert(dataToSave);

            if (error) throw error;
            toast.success(modalType === 'edit' ? 'تم تحديث الحساب' : 'تمت إضافة الحساب');
            handleCloseModal();
            await loadAccounts();
        } catch (err: any) {
            toast.error(`فشل حفظ الحساب: ${err.message}`);
        }
    };
    
    const handleDeleteAccount = async (account: GLAccount) => {
        if (account.children && account.children.length > 0) {
            toast.error('لا يمكن حذف هذا الحساب لأنه يحتوي على حسابات فرعية.');
            return;
        }
        if (window.confirm(`هل أنت متأكد من حذف الحساب "${account.name_ar || account.name}"؟`)) {
            try {
                const supabase = await getSupabase();
                const { error } = await supabase.from('gl_accounts').delete().eq('id', account.id);
                if (error) throw error;
                toast.success('تم حذف الحساب بنجاح');
                await loadAccounts();
            } catch (err: any) {
                toast.error(`فشل حذف الحساب: ${err.message}`);
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

    const handleExportToExcel = () => {
        const tree = buildTree(accounts);
        const flatData = flattenForExport(tree);
        const worksheetData = flatData.map(item => ({
            'المستوى': ' '.repeat(item.level * 2) + item.code,
            'الاسم العربي': item.name_ar,
            'الاسم الانجليزي': item.name,
            'النوع': item.category,
        }));
        const worksheet = XLSX.utils.json_to_sheet(worksheetData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Chart of Accounts");
        XLSX.writeFile(workbook, "ChartOfAccounts.xlsx");
    };

    const handleExportToPdf = () => {
        const doc = new jsPDF();
        // Add a font that supports Arabic
        // doc.addFont('Amiri-Regular.ttf', 'Amiri', 'normal');
        // doc.setFont('Amiri');
        const tree = buildTree(accounts);
        const flatData = flattenForExport(tree);
        const tableData = flatData.map(item => [
            ' '.repeat(item.level * 2) + item.code,
            item.name_ar || item.name, // Fallback to name if name_ar is not available
            item.category,
        ]);

        (doc as any).autoTable({
            head: [['رمز الحساب', 'اسم الحساب', 'النوع']],
            body: tableData,
            styles: { font: 'Arial', halign: 'right' },
            headStyles: { halign: 'right' },
        });

        doc.save('ChartOfAccounts.pdf');
    };
    
    const accountTree = buildTree(accounts);
    
    return (
        <div className="space-y-4 p-4 md:p-6" dir={isRTL ? "rtl" : "ltr"}>
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold">شجرة الحسابات</h1>
                 <div className="flex gap-2">
                    <Button onClick={handleExportToExcel} variant="outline"><FileDown className="me-2 h-4 w-4"/>تصدير Excel</Button>
                    <Button onClick={handleExportToPdf} variant="outline"><FileDown className="me-2 h-4 w-4"/>تصدير PDF</Button>
                    <Button onClick={() => handleOpenModal('add')}><Plus className="me-2 h-4 w-4"/>إضافة حساب</Button>
                </div>
            </div>

            <div className="bg-card rounded-lg border">
                 {loading ? (
                     <div className="p-8 text-center">جاري التحميل...</div>
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
                        />
                    ))
                 ) : (
                     <div className="p-8 text-center text-muted-foreground">لا توجد حسابات لعرضها.</div>
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
