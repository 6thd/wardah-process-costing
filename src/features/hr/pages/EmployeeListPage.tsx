import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Plus, Search, FileDown } from 'lucide-react';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogFooter,
    DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { getEmployees } from '@/services/hr/hr-service';
import { createEmployee } from '@/services/hr/employee-service';
import { STATUS_BADGES } from '../types';

export const EmployeeListPage: React.FC = () => {
    const navigate = useNavigate();
    const { t } = useTranslation();
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [searchQuery, setSearchQuery] = React.useState('');
    const [employeeDialogOpen, setEmployeeDialogOpen] = React.useState(false);
    const [employeeForm, setEmployeeForm] = React.useState({
        firstName: '',
        lastName: '',
        employeeCode: '',
        department: '',
        position: '',
        salary: '',
        hireDate: '',
    });

    const { data: employees = [], isLoading: employeesLoading } = useQuery({
        queryKey: ['hr', 'employees'],
        queryFn: getEmployees,
        staleTime: 60_000,
    });

    const createEmployeeMutation = useMutation({
        mutationFn: () =>
            createEmployee({
                firstName: employeeForm.firstName.trim(),
                lastName: employeeForm.lastName.trim(),
                employeeCode: employeeForm.employeeCode.trim(),
                hireDate: employeeForm.hireDate,
                department: employeeForm.department.trim() || undefined,
                position: employeeForm.position.trim() || undefined,
                salary: employeeForm.salary ? Number(employeeForm.salary) : 0,
            }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['hr', 'employees'] });
            toast({ title: t('messages.saveSuccess') });
            setEmployeeDialogOpen(false);
            setEmployeeForm({
                firstName: '',
                lastName: '',
                employeeCode: '',
                department: '',
                position: '',
                salary: '',
                hireDate: '',
            });
        },
        onError: (error: any) => {
            toast({
                title: t('messages.operationFailed'),
                description: error?.message ?? '',
                variant: 'destructive',
            });
        },
    });

    const filteredEmployees = React.useMemo(() => {
        if (!searchQuery) return employees;
        const lower = searchQuery.toLowerCase();
        return employees.filter(
            (emp) =>
                emp.name.toLowerCase().includes(lower) ||
                emp.code?.toLowerCase().includes(lower) ||
                emp.department?.toLowerCase().includes(lower)
        );
    }, [employees, searchQuery]);

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">سجل الموظفين</h1>
                    <p className="text-muted-foreground">
                        إدارة ملفات الموظفين، العقود، والبيانات الوظيفية.
                    </p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" className="gap-2">
                        <FileDown className="h-4 w-4" />
                        تصدير
                    </Button>
                    <Button onClick={() => setEmployeeDialogOpen(true)} className="gap-2">
                        <Plus className="h-4 w-4" />
                        إضافة موظف
                    </Button>
                </div>
            </div>

            <Card className="border-border/60 shadow-sm">
                <CardHeader className="p-4">
                    <div className="relative">
                        <Search className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="بحث باسم الموظف، الرقم الوظيفي، أو القسم..."
                            className="pr-9"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    {employeesLoading ? (
                        <div className="p-8 text-center text-muted-foreground">جارٍ تحميل البيانات...</div>
                    ) : filteredEmployees.length === 0 ? (
                        <div className="p-8 text-center text-muted-foreground">
                            لم يتم العثور على موظفين مطابقين للبحث.
                        </div>
                    ) : (
                        <ScrollArea className="h-[600px]">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>الموظف</TableHead>
                                        <TableHead>القسم</TableHead>
                                        <TableHead>الوظيفة</TableHead>
                                        <TableHead>تاريخ التعيين</TableHead>
                                        <TableHead>انتهاء العقد</TableHead>
                                        <TableHead className="text-right">الراتب</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filteredEmployees.map((employee) => (
                                        <TableRow
                                            key={employee.id}
                                            className="cursor-pointer hover:bg-slate-50"
                                            onClick={() => navigate(`/hr/employees/${employee.id}`)}
                                        >
                                            <TableCell>
                                                <div className="font-semibold">{employee.name}</div>
                                                <div className="text-xs text-muted-foreground">{employee.code || '—'}</div>
                                            </TableCell>
                                            <TableCell>{employee.department || '—'}</TableCell>
                                            <TableCell>
                                                <div className="flex items-center gap-2">
                                                    <span>{employee.jobTitle || '—'}</span>
                                                    <Badge
                                                        variant="outline"
                                                        className={`text-xs ${STATUS_BADGES[employee.status] ?? 'bg-slate-100 text-slate-800'}`}
                                                    >
                                                        {employee.status === 'active'
                                                            ? 'نشط'
                                                            : employee.status === 'probation'
                                                                ? 'تحت التجربة'
                                                                : 'غير نشط'}
                                                    </Badge>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                {employee.hiringDate
                                                    ? new Date(employee.hiringDate).toLocaleDateString()
                                                    : '—'}
                                            </TableCell>
                                            <TableCell>
                                                {employee.contractEndDate
                                                    ? new Date(employee.contractEndDate).toLocaleDateString()
                                                    : 'مفتوح'}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                {employee.salary?.toLocaleString() ?? '—'}{' '}
                                                <span className="text-xs text-muted-foreground">{employee.currency}</span>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </ScrollArea>
                    )}
                </CardContent>
            </Card>

            <Dialog open={employeeDialogOpen} onOpenChange={setEmployeeDialogOpen}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>إضافة موظف جديد</DialogTitle>
                        <DialogDescription>
                            إدخال بيانات الموظف وربطها تلقائياً بالمؤسسة الحالية.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-1 md:col-span-2">
                            <label className="text-sm font-medium">الاسم الأول</label>
                            <Input
                                value={employeeForm.firstName}
                                onChange={(event) =>
                                    setEmployeeForm((prev) => ({ ...prev, firstName: event.target.value }))
                                }
                            />
                        </div>
                        <div className="space-y-1 md:col-span-2">
                            <label className="text-sm font-medium">اسم العائلة</label>
                            <Input
                                value={employeeForm.lastName}
                                onChange={(event) =>
                                    setEmployeeForm((prev) => ({ ...prev, lastName: event.target.value }))
                                }
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-sm font-medium">الرقم الوظيفي / الكود</label>
                            <Input
                                value={employeeForm.employeeCode}
                                onChange={(event) =>
                                    setEmployeeForm((prev) => ({ ...prev, employeeCode: event.target.value }))
                                }
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-sm font-medium">تاريخ التعيين</label>
                            <Input
                                type="date"
                                value={employeeForm.hireDate}
                                onChange={(event) =>
                                    setEmployeeForm((prev) => ({ ...prev, hireDate: event.target.value }))
                                }
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-sm font-medium">القسم</label>
                            <Input
                                value={employeeForm.department}
                                onChange={(event) =>
                                    setEmployeeForm((prev) => ({ ...prev, department: event.target.value }))
                                }
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-sm font-medium">المسمى الوظيفي</label>
                            <Input
                                value={employeeForm.position}
                                onChange={(event) =>
                                    setEmployeeForm((prev) => ({ ...prev, position: event.target.value }))
                                }
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-sm font-medium">الراتب الأساسي</label>
                            <Input
                                type="number"
                                min={0}
                                value={employeeForm.salary}
                                onChange={(event) =>
                                    setEmployeeForm((prev) => ({ ...prev, salary: event.target.value }))
                                }
                            />
                        </div>
                    </div>
                    <DialogFooter className="mt-4 flex flex-row justify-between gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => setEmployeeDialogOpen(false)}
                        >
                            إلغاء
                        </Button>
                        <Button
                            type="button"
                            disabled={createEmployeeMutation.isPending}
                            onClick={() => createEmployeeMutation.mutate()}
                        >
                            {createEmployeeMutation.isPending ? t('messages.loading') : 'حفظ الموظف'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};
