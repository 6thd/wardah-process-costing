// src/features/hr/pages/EmployeeListPage.tsx
// بسم الله الرحمن الرحيم
// صفحة إدارة الموظفين المحسنة

import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
    Plus, Search, FileDown, Grid3x3, List, Edit, Trash2,
    MoreHorizontal, UserPlus, Users, Building2, Briefcase, Calendar,
    X
} from 'lucide-react';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogFooter,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { getEmployees } from '@/services/hr/hr-service';
import { createEmployee, deleteEmployee } from '@/services/hr/employee-service';
import { STATUS_BADGES } from '../types';
import { getHrStatusKey, useHrTranslation } from '../i18n';

type ViewMode = 'table' | 'grid';
type FilterStatus = 'all' | 'active' | 'inactive' | 'probation' | 'terminated';

export const EmployeeListPage: React.FC = () => {
    const navigate = useNavigate();
    const { t, i18n } = useHrTranslation();
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const isRtl = i18n.dir() === 'rtl';
    const dateLocale = isRtl ? 'ar-SA' : 'en-US';

    // State
    const [searchQuery, setSearchQuery] = React.useState('');
    const [viewMode, setViewMode] = React.useState<ViewMode>('table');
    const [filterStatus, setFilterStatus] = React.useState<FilterStatus>('all');
    const [filterDepartment, setFilterDepartment] = React.useState<string>('all');
    const [selectedEmployees, setSelectedEmployees] = React.useState<Set<string>>(new Set());
    const [employeeDialogOpen, setEmployeeDialogOpen] = React.useState(false);
    const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);
    const [employeeToDelete, setEmployeeToDelete] = React.useState<string | null>(null);

    const [employeeForm, setEmployeeForm] = React.useState({
        firstName: '',
        lastName: '',
        employeeCode: '',
        department: '',
        position: '',
        salary: '',
        hireDate: '',
        email: '',
        phone: '',
    });

    // Queries
    const { data: employees = [], isLoading: employeesLoading } = useQuery({
        queryKey: ['hr', 'employees'],
        queryFn: getEmployees,
        staleTime: 60_000,
    });

    // Mutations
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
            toast({ title: t('employeeList.toast.createSuccess') });
            setEmployeeDialogOpen(false);
            resetForm();
        },
        onError: (error: any) => {
            toast({
                title: t('employeeList.toast.createError'),
                description: error?.message ?? '',
                variant: 'destructive',
            });
        },
    });

    // Computed values
    const departments = React.useMemo(() => {
        const depts = new Set(employees.map(e => e.department).filter(Boolean));
        return Array.from(depts);
    }, [employees]);

    const filteredEmployees = React.useMemo(() => {
        let result = employees;

        if (searchQuery) {
            const lower = searchQuery.toLowerCase();
            result = result.filter(
                (emp) =>
                    emp.name.toLowerCase().includes(lower) ||
                    emp.code?.toLowerCase().includes(lower) ||
                    emp.department?.toLowerCase().includes(lower) ||
                    emp.jobTitle?.toLowerCase().includes(lower)
            );
        }

        if (filterStatus !== 'all') {
            result = result.filter(emp => emp.status === filterStatus);
        }

        if (filterDepartment !== 'all') {
            result = result.filter(emp => emp.department === filterDepartment);
        }

        return result;
    }, [employees, searchQuery, filterStatus, filterDepartment]);

    const stats = React.useMemo(() => ({
        total: employees.length,
        active: employees.filter(e => e.status === 'active').length,
        inactive: employees.filter(e => e.status === 'inactive').length,
        probation: employees.filter(e => e.status === 'probation').length,
    }), [employees]);

    const statusLabel = React.useCallback(
        (status?: string | null) => t(getHrStatusKey(status)),
        [t],
    );

    // Handlers
    const resetForm = () => {
        setEmployeeForm({
            firstName: '',
            lastName: '',
            employeeCode: '',
            department: '',
            position: '',
            salary: '',
            hireDate: '',
            email: '',
            phone: '',
        });
    };

    const handleSelectAll = (checked: boolean) => {
        setSelectedEmployees(checked ? new Set(filteredEmployees.map(e => e.id)) : new Set());
    };

    const handleSelectEmployee = (id: string, checked: boolean) => {
        const newSelected = new Set(selectedEmployees);
        if (checked) newSelected.add(id);
        else newSelected.delete(id);
        setSelectedEmployees(newSelected);
    };

    const handleExport = () => {
        const csvContent = [
            [
                t('employeeList.csv.employeeCode'),
                t('employeeList.csv.name'),
                t('employeeList.csv.department'),
                t('employeeList.csv.position'),
                t('employeeList.csv.status'),
                t('employeeList.csv.salary'),
                t('employeeList.csv.hireDate'),
            ].join(','),
            ...filteredEmployees.map(emp => [
                emp.code || '',
                emp.name,
                emp.department || '',
                emp.jobTitle || '',
                statusLabel(emp.status),
                emp.salary || 0,
                emp.hiringDate || ''
            ].join(','))
        ].join('\n');

        const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `employees_${new Date().toISOString().split('T')[0]}.csv`;
        link.click();
        URL.revokeObjectURL(link.href);
        toast({ title: t('employeeList.toast.exportSuccess') });
    };

    const deleteEmployeeMutation = useMutation({
        mutationFn: (ids: string[]) => Promise.all(ids.map((id) => deleteEmployee(id))),
        onSuccess: (_data, ids) => {
            queryClient.invalidateQueries({ queryKey: ['hr', 'employees'] });
            toast({ title: t('employeeList.toast.deleteSuccess', { count: ids.length }) });
            setSelectedEmployees(new Set());
        },
        onError: (error: any) => {
            toast({
                title: t('employeeList.toast.deleteError'),
                description: error?.message ?? '',
                variant: 'destructive',
            });
        },
        onSettled: () => {
            setDeleteDialogOpen(false);
            setEmployeeToDelete(null);
        },
    });

    const handleBulkDelete = () => {
        if (selectedEmployees.size === 0) return;
        deleteEmployeeMutation.mutate([...selectedEmployees]);
    };

    const handleDeleteEmployee = (id: string) => {
        setEmployeeToDelete(id);
        setDeleteDialogOpen(true);
    };

    const confirmDelete = () => {
        if (!employeeToDelete) return;
        deleteEmployeeMutation.mutate([employeeToDelete]);
    };

    const allSelected = filteredEmployees.length > 0 && selectedEmployees.size === filteredEmployees.length;

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">{t('employeeList.title')}</h1>
                    <p className="text-muted-foreground">{t('employeeList.subtitle')}</p>
                </div>
                <div className="flex gap-2">
                    {selectedEmployees.size > 0 && (
                        <Button variant="outline" onClick={handleBulkDelete} className="gap-2">
                            <Trash2 className="h-4 w-4" />
                            {t('employeeList.deleteSelected', { count: selectedEmployees.size })}
                        </Button>
                    )}
                    <Button variant="outline" onClick={handleExport} className="gap-2">
                        <FileDown className="h-4 w-4" />
                        {t('common.export')}
                    </Button>
                    <Button onClick={() => setEmployeeDialogOpen(true)} className="gap-2 bg-teal-600 hover:bg-teal-700">
                        <Plus className="h-4 w-4" />
                        {t('employeeList.addEmployee')}
                    </Button>
                </div>
            </div>

            <div className="grid gap-4 md:grid-cols-4">
                {[
                    { key: 'total', label: t('employeeList.stats.total'), value: stats.total, icon: Users, color: 'text-blue-500' },
                    { key: 'active', label: t('employeeList.stats.active'), value: stats.active, icon: UserPlus, color: 'text-emerald-500' },
                    { key: 'probation', label: t('employeeList.stats.probation'), value: stats.probation, icon: Calendar, color: 'text-amber-500' },
                    { key: 'inactive', label: t('employeeList.stats.inactive'), value: stats.inactive, icon: X, color: 'text-rose-500' },
                ].map((stat) => {
                    const Icon = stat.icon;
                    return (
                        <Card key={stat.key} className="border-border/60 bg-card">
                            <CardContent className="p-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm text-muted-foreground">{stat.label}</p>
                                        <p className="text-2xl font-bold mt-1">{stat.value}</p>
                                    </div>
                                    <Icon className={`h-8 w-8 ${stat.color} opacity-80`} />
                                </div>
                            </CardContent>
                        </Card>
                    );
                })}
            </div>

            <Card className="border-border/60 shadow-sm">
                <CardContent className="p-4">
                    <div className="flex flex-col md:flex-row gap-4">
                        <div className="flex-1 relative">
                            <Search className={`absolute top-2.5 h-4 w-4 text-muted-foreground ${isRtl ? 'right-3' : 'left-3'}`} />
                            <Input
                                placeholder={t('employeeList.searchPlaceholder')}
                                className={isRtl ? 'pr-9' : 'pl-9'}
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>
                        <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v as FilterStatus)}>
                            <SelectTrigger className="w-full md:w-[180px]">
                                <SelectValue placeholder={t('employeeList.filters.status')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">{t('common.allStatuses')}</SelectItem>
                                <SelectItem value="active">{statusLabel('active')}</SelectItem>
                                <SelectItem value="probation">{statusLabel('probation')}</SelectItem>
                                <SelectItem value="inactive">{statusLabel('inactive')}</SelectItem>
                                <SelectItem value="terminated">{statusLabel('terminated')}</SelectItem>
                            </SelectContent>
                        </Select>
                        <Select value={filterDepartment} onValueChange={setFilterDepartment}>
                            <SelectTrigger className="w-full md:w-[180px]">
                                <SelectValue placeholder={t('employeeList.filters.department')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">{t('common.allDepartments')}</SelectItem>
                                {departments.map(dept => (
                                    <SelectItem key={dept} value={dept!}>{dept}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <div className="flex gap-2">
                            <Button
                                variant={viewMode === 'table' ? 'default' : 'outline'}
                                size="icon"
                                onClick={() => setViewMode('table')}
                                aria-label={t('employeeList.viewEdit')}
                            >
                                <List className="h-4 w-4" />
                            </Button>
                            <Button
                                variant={viewMode === 'grid' ? 'default' : 'outline'}
                                size="icon"
                                onClick={() => setViewMode('grid')}
                                aria-label={t('employeeList.viewEdit')}
                            >
                                <Grid3x3 className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>

            <Card className="border-border/60 shadow-sm">
                <CardContent className="p-0">
                    {employeesLoading ? (
                        <div className="p-12 text-center">
                            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-teal-500 border-r-transparent" />
                            <p className="mt-4 text-muted-foreground">{t('employeeList.loading')}</p>
                        </div>
                    ) : filteredEmployees.length === 0 ? (
                        <div className="p-12 text-center text-muted-foreground">
                            <Users className="h-16 w-16 mx-auto mb-4 opacity-50" />
                            <p className="text-lg font-medium">{t('employeeList.emptyTitle')}</p>
                            <p className="text-sm">{t('employeeList.emptyDescription')}</p>
                        </div>
                    ) : viewMode === 'table' ? (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-12">
                                            <Checkbox
                                                checked={allSelected}
                                                onCheckedChange={handleSelectAll}
                                                aria-label={t('employeeList.selectAll')}
                                            />
                                        </TableHead>
                                        <TableHead>{t('employeeList.columns.employee')}</TableHead>
                                        <TableHead>{t('employeeList.columns.department')}</TableHead>
                                        <TableHead>{t('employeeList.columns.position')}</TableHead>
                                        <TableHead>{t('employeeList.columns.status')}</TableHead>
                                        <TableHead>{t('employeeList.columns.hireDate')}</TableHead>
                                        <TableHead className={isRtl ? 'text-right' : 'text-left'}>{t('employeeList.columns.salary')}</TableHead>
                                        <TableHead className="w-12" />
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filteredEmployees.map((employee) => (
                                        <TableRow key={employee.id} className="cursor-pointer hover:bg-muted/50">
                                            <TableCell onClick={(e) => e.stopPropagation()}>
                                                <Checkbox
                                                    checked={selectedEmployees.has(employee.id)}
                                                    onCheckedChange={(checked) => handleSelectEmployee(employee.id, checked as boolean)}
                                                    aria-label={t('employeeList.selectEmployee', { name: employee.name })}
                                                />
                                            </TableCell>
                                            <TableCell onClick={() => navigate(`/hr/employees/${employee.id}`)}>
                                                <div className="flex items-center gap-3">
                                                    <div className="h-10 w-10 rounded-full bg-gradient-to-br from-teal-500 to-cyan-500 flex items-center justify-center text-white font-semibold">
                                                        {employee.name.charAt(0).toUpperCase()}
                                                    </div>
                                                    <div>
                                                        <div className="font-semibold">{employee.name}</div>
                                                        <div className="text-xs text-muted-foreground">{employee.code || '—'}</div>
                                                    </div>
                                                </div>
                                            </TableCell>
                                            <TableCell onClick={() => navigate(`/hr/employees/${employee.id}`)}>
                                                <div className="flex items-center gap-2">
                                                    <Building2 className="h-4 w-4 text-muted-foreground" />
                                                    {employee.department || '—'}
                                                </div>
                                            </TableCell>
                                            <TableCell onClick={() => navigate(`/hr/employees/${employee.id}`)}>
                                                <div className="flex items-center gap-2">
                                                    <Briefcase className="h-4 w-4 text-muted-foreground" />
                                                    {employee.jobTitle || '—'}
                                                </div>
                                            </TableCell>
                                            <TableCell onClick={() => navigate(`/hr/employees/${employee.id}`)}>
                                                <Badge className={STATUS_BADGES[employee.status]}>{statusLabel(employee.status)}</Badge>
                                            </TableCell>
                                            <TableCell onClick={() => navigate(`/hr/employees/${employee.id}`)}>
                                                {employee.hiringDate ? new Date(employee.hiringDate).toLocaleDateString(dateLocale) : '—'}
                                            </TableCell>
                                            <TableCell className={isRtl ? 'text-right' : 'text-left'} onClick={() => navigate(`/hr/employees/${employee.id}`)}>
                                                <span className="font-semibold">{employee.salary?.toLocaleString(dateLocale) ?? '—'}</span>
                                                <span className={`text-xs text-muted-foreground ${isRtl ? 'mr-1' : 'ml-1'}`}>{employee.currency}</span>
                                            </TableCell>
                                            <TableCell onClick={(e) => e.stopPropagation()}>
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button variant="ghost" size="icon" aria-label={t('common.actions')}>
                                                            <MoreHorizontal className="h-4 w-4" />
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end">
                                                        <DropdownMenuLabel>{t('common.actions')}</DropdownMenuLabel>
                                                        <DropdownMenuSeparator />
                                                        <DropdownMenuItem onClick={() => navigate(`/hr/employees/${employee.id}`)}>
                                                            <Edit className={`h-4 w-4 ${isRtl ? 'ml-2' : 'mr-2'}`} />
                                                            {t('employeeList.viewEdit')}
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem onClick={() => handleDeleteEmployee(employee.id)} className="text-rose-500">
                                                            <Trash2 className={`h-4 w-4 ${isRtl ? 'ml-2' : 'mr-2'}`} />
                                                            {t('common.delete')}
                                                        </DropdownMenuItem>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    ) : (
                        <div className="grid gap-4 p-6 md:grid-cols-2 lg:grid-cols-3">
                            {filteredEmployees.map((employee) => (
                                <Card
                                    key={employee.id}
                                    className="border-border/60 hover:border-teal-500/50 transition-all cursor-pointer"
                                    onClick={() => navigate(`/hr/employees/${employee.id}`)}
                                >
                                    <CardContent className="p-6">
                                        <div className="flex items-start justify-between mb-4">
                                            <div className="h-12 w-12 rounded-full bg-gradient-to-br from-teal-500 to-cyan-500 flex items-center justify-center text-white font-bold text-lg">
                                                {employee.name.charAt(0).toUpperCase()}
                                            </div>
                                            <Badge className={STATUS_BADGES[employee.status]}>{statusLabel(employee.status)}</Badge>
                                        </div>
                                        <h3 className="font-semibold text-lg mb-1">{employee.name}</h3>
                                        <p className="text-sm text-muted-foreground mb-4">{employee.code || '—'}</p>
                                        <div className="space-y-2 text-sm">
                                            <div className="flex items-center gap-2 text-muted-foreground">
                                                <Building2 className="h-4 w-4" />
                                                <span>{employee.department || '—'}</span>
                                            </div>
                                            <div className="flex items-center gap-2 text-muted-foreground">
                                                <Briefcase className="h-4 w-4" />
                                                <span>{employee.jobTitle || '—'}</span>
                                            </div>
                                            <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
                                                <span className="text-xs text-muted-foreground">{t('employeeList.columns.salary')}</span>
                                                <span className="font-semibold">{employee.salary?.toLocaleString(dateLocale) ?? '—'} {employee.currency}</span>
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            <Dialog open={employeeDialogOpen} onOpenChange={setEmployeeDialogOpen}>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="text-xl">{t('employeeList.dialog.title')}</DialogTitle>
                        <DialogDescription>{t('employeeList.dialog.description')}</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 md:grid-cols-2 py-4">
                        <div className="space-y-2">
                            <Label htmlFor="firstName">{t('employeeList.dialog.firstName')}</Label>
                            <Input id="firstName" value={employeeForm.firstName} onChange={(e) => setEmployeeForm(prev => ({ ...prev, firstName: e.target.value }))} placeholder={t('employeeList.dialog.firstNamePlaceholder')} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="lastName">{t('employeeList.dialog.lastName')}</Label>
                            <Input id="lastName" value={employeeForm.lastName} onChange={(e) => setEmployeeForm(prev => ({ ...prev, lastName: e.target.value }))} placeholder={t('employeeList.dialog.lastNamePlaceholder')} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="employeeCode">{t('employeeList.dialog.employeeCode')}</Label>
                            <Input id="employeeCode" value={employeeForm.employeeCode} onChange={(e) => setEmployeeForm(prev => ({ ...prev, employeeCode: e.target.value }))} placeholder="EMP-001" />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="hireDate">{t('employeeList.dialog.hireDate')}</Label>
                            <Input id="hireDate" type="date" value={employeeForm.hireDate} onChange={(e) => setEmployeeForm(prev => ({ ...prev, hireDate: e.target.value }))} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="department">{t('employeeList.dialog.department')}</Label>
                            <Input id="department" value={employeeForm.department} onChange={(e) => setEmployeeForm(prev => ({ ...prev, department: e.target.value }))} placeholder={t('employeeList.dialog.departmentPlaceholder')} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="position">{t('employeeList.dialog.position')}</Label>
                            <Input id="position" value={employeeForm.position} onChange={(e) => setEmployeeForm(prev => ({ ...prev, position: e.target.value }))} placeholder={t('employeeList.dialog.positionPlaceholder')} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="salary">{t('employeeList.dialog.baseSalary')}</Label>
                            <Input id="salary" type="number" min={0} value={employeeForm.salary} onChange={(e) => setEmployeeForm(prev => ({ ...prev, salary: e.target.value }))} placeholder="10000" />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="email">{t('employeeList.dialog.email')}</Label>
                            <Input id="email" type="email" value={employeeForm.email} onChange={(e) => setEmployeeForm(prev => ({ ...prev, email: e.target.value }))} placeholder="ahmad@example.com" />
                        </div>
                        <div className="space-y-2 md:col-span-2">
                            <Label htmlFor="phone">{t('employeeList.dialog.phone')}</Label>
                            <Input id="phone" type="tel" value={employeeForm.phone} onChange={(e) => setEmployeeForm(prev => ({ ...prev, phone: e.target.value }))} placeholder="+966 50 123 4567" />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => { setEmployeeDialogOpen(false); resetForm(); }}>
                            {t('common.cancel')}
                        </Button>
                        <Button
                            type="button"
                            disabled={createEmployeeMutation.isPending || !employeeForm.firstName || !employeeForm.lastName || !employeeForm.employeeCode || !employeeForm.hireDate}
                            onClick={() => createEmployeeMutation.mutate()}
                            className="bg-teal-600 hover:bg-teal-700"
                        >
                            {createEmployeeMutation.isPending ? t('common.saving') : t('employeeList.dialog.save')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('employeeList.deleteDialog.title')}</AlertDialogTitle>
                        <AlertDialogDescription>{t('employeeList.deleteDialog.description')}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                        <AlertDialogAction onClick={confirmDelete} className="bg-rose-600 hover:bg-rose-700">
                            {t('common.delete')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};
