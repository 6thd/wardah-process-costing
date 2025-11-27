// src/features/hr/pages/SettlementsPage.tsx
// بسم الله الرحمن الرحيم
// صفحة تسويات نهاية الخدمة

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import {
  Calculator,
  FileText,
  DollarSign,
  Calendar,
  User,
  Plus,
  Search,
  Download,
  Printer,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Briefcase,
} from 'lucide-react';
import { getSettlementRecords, getEmployees } from '@/services/hr/hr-service';
import { STATUS_BADGES } from '../types';

// أنواع إنهاء الخدمة
const TERMINATION_TYPES = [
  { id: 'resignation', name: 'استقالة', color: 'text-blue-500' },
  { id: 'end_of_contract', name: 'انتهاء العقد', color: 'text-slate-500' },
  { id: 'termination', name: 'فصل', color: 'text-rose-500' },
  { id: 'retirement', name: 'تقاعد', color: 'text-amber-500' },
  { id: 'death', name: 'وفاة', color: 'text-purple-500' },
];

export const SettlementsPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState('pending');
  const [searchQuery, setSearchQuery] = useState('');
  const [showNewSettlementDialog, setShowNewSettlementDialog] = useState(false);
  const [showDetailsDialog, setShowDetailsDialog] = useState(false);
  const [selectedSettlement, setSelectedSettlement] = useState<any>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<string>('');

  // جلب سجلات التسويات
  const { data: settlements = [], isLoading } = useQuery({
    queryKey: ['hr', 'settlements'],
    queryFn: () => getSettlementRecords(100),
  });

  // جلب قائمة الموظفين
  const { data: employees = [] } = useQuery({
    queryKey: ['hr', 'employees'],
    queryFn: () => getEmployees(500),
  });

  // تصفية التسويات
  const filteredSettlements = React.useMemo(() => {
    return settlements.filter((s: any) => {
      const matchesTab = activeTab === 'all' || s.status === activeTab;
      const matchesSearch = !searchQuery ||
        s.employeeName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.employeeId?.includes(searchQuery);
      return matchesTab && matchesSearch;
    });
  }, [settlements, activeTab, searchQuery]);

  // إحصائيات التسويات
  const settlementStats = React.useMemo(() => {
    const totalAmount = settlements.reduce((sum: number, s: any) => sum + (s.totalAmount || 0), 0);
    return {
      pending: settlements.filter((s: any) => s.status === 'pending').length,
      approved: settlements.filter((s: any) => s.status === 'approved').length,
      paid: settlements.filter((s: any) => s.status === 'paid').length,
      total: settlements.length,
      totalAmount,
    };
  }, [settlements]);

  const getTerminationType = (typeId: string) => {
    return TERMINATION_TYPES.find(t => t.id === typeId) || TERMINATION_TYPES[0];
  };

  // حساب مكافأة نهاية الخدمة
  const calculateEndOfService = (years: number, lastSalary: number, terminationType: string) => {
    let multiplier = 0;
    
    if (terminationType === 'resignation') {
      // استقالة
      if (years >= 2 && years < 5) {
        multiplier = 0.5 * (years * 0.5); // ثلث المكافأة للسنوات الأولى
      } else if (years >= 5 && years < 10) {
        multiplier = (2.5 * 0.5) + ((years - 5) * 0.667); // ثلثين للسنوات بعد الخامسة
      } else if (years >= 10) {
        multiplier = (2.5 * 0.5) + (5 * 0.667) + ((years - 10) * 1); // كامل بعد 10 سنوات
      }
    } else {
      // باقي الحالات - مكافأة كاملة
      if (years <= 5) {
        multiplier = years * 0.5;
      } else {
        multiplier = 2.5 + ((years - 5) * 1);
      }
    }
    
    return lastSalary * multiplier;
  };

  return (
    <div className="space-y-6">
      {/* العنوان */}
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">تسويات نهاية الخدمة</h1>
        <p className="text-muted-foreground">
          إدارة حسابات مكافآت نهاية الخدمة والتسويات المالية للموظفين المنتهية خدماتهم
        </p>
      </div>

      {/* بطاقات الإحصائيات */}
      <div className="grid gap-4 md:grid-cols-5">
        <Card className="border-amber-500/30 bg-amber-500/10">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-amber-400">قيد المعالجة</p>
                <p className="text-2xl font-bold text-amber-300">{settlementStats.pending}</p>
              </div>
              <Clock className="h-8 w-8 text-amber-500" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-blue-500/30 bg-blue-500/10">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-blue-400">معتمدة</p>
                <p className="text-2xl font-bold text-blue-300">{settlementStats.approved}</p>
              </div>
              <CheckCircle2 className="h-8 w-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-emerald-500/30 bg-emerald-500/10">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-emerald-400">مدفوعة</p>
                <p className="text-2xl font-bold text-emerald-300">{settlementStats.paid}</p>
              </div>
              <DollarSign className="h-8 w-8 text-emerald-500" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-slate-500/30 bg-slate-500/10">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-400">الإجمالي</p>
                <p className="text-2xl font-bold text-slate-300">{settlementStats.total}</p>
              </div>
              <Briefcase className="h-8 w-8 text-slate-500" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-purple-500/30 bg-purple-500/10">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-purple-400">إجمالي المبالغ</p>
                <p className="text-xl font-bold text-purple-300">
                  {settlementStats.totalAmount.toLocaleString()} ر.س
                </p>
              </div>
              <Calculator className="h-8 w-8 text-purple-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* حاسبة مكافأة نهاية الخدمة */}
      <Card className="bg-gradient-to-br from-teal-500/10 to-cyan-500/10 border-teal-500/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
              <Calculator className="h-5 w-5 text-teal-400" />
            حاسبة مكافأة نهاية الخدمة (نظام العمل السعودي)
          </CardTitle>
          <CardDescription>
            احسب مكافأة نهاية الخدمة وفقاً لنظام العمل السعودي
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-4">
            <div className="space-y-2">
              <Label>سنوات الخدمة</Label>
              <Input type="number" placeholder="5" id="calc-years" />
            </div>
            <div className="space-y-2">
              <Label>آخر راتب أساسي</Label>
              <Input type="number" placeholder="10000" id="calc-salary" />
            </div>
            <div className="space-y-2">
              <Label>سبب انتهاء الخدمة</Label>
              <Select defaultValue="resignation">
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TERMINATION_TYPES.map((type) => (
                    <SelectItem key={type.id} value={type.id}>{type.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>&nbsp;</Label>
              <Button className="w-full bg-teal-600 hover:bg-teal-700">
                <Calculator className="h-4 w-4 ml-2" />
                احسب المكافأة
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* قائمة التسويات */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg">سجل التسويات</CardTitle>
            <CardDescription>جميع تسويات نهاية الخدمة</CardDescription>
          </div>
          <Button onClick={() => setShowNewSettlementDialog(true)}>
            <Plus className="h-4 w-4 ml-2" />
            تسوية جديدة
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* أدوات التصفية */}
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="بحث بالاسم أو الرقم الوظيفي..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pr-10"
              />
            </div>
          </div>

          {/* التبويبات */}
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="pending">قيد المعالجة</TabsTrigger>
              <TabsTrigger value="approved">معتمدة</TabsTrigger>
              <TabsTrigger value="paid">مدفوعة</TabsTrigger>
              <TabsTrigger value="all">الكل</TabsTrigger>
            </TabsList>

            <TabsContent value={activeTab} className="mt-4">
              {isLoading ? (
                <div className="text-center py-8 text-muted-foreground">جارٍ التحميل...</div>
              ) : filteredSettlements.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Briefcase className="h-12 w-12 mx-auto text-slate-300 mb-3" />
                  <p>لا توجد تسويات</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>الموظف</TableHead>
                      <TableHead>سبب الإنهاء</TableHead>
                      <TableHead>تاريخ الإنهاء</TableHead>
                      <TableHead>سنوات الخدمة</TableHead>
                      <TableHead>إجمالي التسوية</TableHead>
                      <TableHead>الحالة</TableHead>
                      <TableHead>الإجراءات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredSettlements.map((settlement: any) => {
                      const termType = getTerminationType(settlement.terminationType);
                      return (
                        <TableRow key={settlement.id}>
                          <TableCell>
                            <div>
                              <p className="font-medium">{settlement.employeeName || '—'}</p>
                              <p className="text-xs text-muted-foreground">{settlement.employeeId}</p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <span className={termType.color}>{termType.name}</span>
                          </TableCell>
                          <TableCell>
                            {new Date(settlement.terminationDate).toLocaleDateString('ar-SA')}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{settlement.yearsOfService} سنة</Badge>
                          </TableCell>
                          <TableCell className="font-semibold">
                            {settlement.totalAmount?.toLocaleString()} ر.س
                          </TableCell>
                          <TableCell>
                            <Badge className={STATUS_BADGES[settlement.status] || 'bg-slate-100 text-slate-700'}>
                              {settlement.status === 'pending' && 'قيد المعالجة'}
                              {settlement.status === 'approved' && 'معتمدة'}
                              {settlement.status === 'paid' && 'مدفوعة'}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setSelectedSettlement(settlement);
                                  setShowDetailsDialog(true);
                                }}
                              >
                                <FileText className="h-4 w-4" />
                              </Button>
                              <Button size="sm" variant="outline">
                                <Printer className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* نافذة تفاصيل التسوية */}
      <Dialog open={showDetailsDialog} onOpenChange={setShowDetailsDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>تفاصيل التسوية</DialogTitle>
            <DialogDescription>
              تفاصيل مكافأة نهاية الخدمة والمستحقات
            </DialogDescription>
          </DialogHeader>
          {selectedSettlement && (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-lg border p-4 space-y-3">
                  <h4 className="font-semibold text-sm text-muted-foreground">بيانات الموظف</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span>الاسم:</span>
                      <span className="font-medium">{selectedSettlement.employeeName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>الرقم الوظيفي:</span>
                      <span>{selectedSettlement.employeeId}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>تاريخ التعيين:</span>
                      <span>{new Date(selectedSettlement.hireDate).toLocaleDateString('ar-SA')}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>تاريخ الإنهاء:</span>
                      <span>{new Date(selectedSettlement.terminationDate).toLocaleDateString('ar-SA')}</span>
                    </div>
                  </div>
                </div>
                <div className="rounded-lg border p-4 space-y-3">
                  <h4 className="font-semibold text-sm text-muted-foreground">تفاصيل التسوية</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span>سنوات الخدمة:</span>
                      <span className="font-medium">{selectedSettlement.yearsOfService} سنة</span>
                    </div>
                    <div className="flex justify-between">
                      <span>آخر راتب:</span>
                      <span>{selectedSettlement.lastSalary?.toLocaleString()} ر.س</span>
                    </div>
                    <div className="flex justify-between">
                      <span>مكافأة نهاية الخدمة:</span>
                      <span>{selectedSettlement.endOfServiceAmount?.toLocaleString()} ر.س</span>
                    </div>
                    <div className="flex justify-between">
                      <span>رصيد الإجازات:</span>
                      <span>{selectedSettlement.leaveBalance?.toLocaleString()} ر.س</span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="rounded-lg bg-teal-500/10 border border-teal-500/30 p-4">
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-teal-300">إجمالي التسوية:</span>
                  <span className="text-2xl font-bold text-teal-400">
                    {selectedSettlement.totalAmount?.toLocaleString()} ر.س
                  </span>
                </div>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowDetailsDialog(false)}>
              إغلاق
            </Button>
            <Button variant="outline">
              <Printer className="h-4 w-4 ml-2" />
              طباعة
            </Button>
            <Button className="bg-teal-600 hover:bg-teal-700">
              <Download className="h-4 w-4 ml-2" />
              تحميل PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* نافذة تسوية جديدة */}
      <Dialog open={showNewSettlementDialog} onOpenChange={setShowNewSettlementDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>إنشاء تسوية جديدة</DialogTitle>
            <DialogDescription>
              إنشاء تسوية نهاية خدمة لموظف
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>الموظف</Label>
              <Select value={selectedEmployee} onValueChange={setSelectedEmployee}>
                <SelectTrigger>
                  <SelectValue placeholder="اختر الموظف" />
                </SelectTrigger>
                <SelectContent>
                  {employees.map((emp: any) => (
                    <SelectItem key={emp.id} value={emp.id}>
                      {emp.fullNameAr || emp.fullName} - {emp.employeeId}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>سبب إنهاء الخدمة</Label>
              <Select>
                <SelectTrigger>
                  <SelectValue placeholder="اختر السبب" />
                </SelectTrigger>
                <SelectContent>
                  {TERMINATION_TYPES.map((type) => (
                    <SelectItem key={type.id} value={type.id}>{type.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>تاريخ الإنهاء</Label>
              <Input type="date" />
            </div>
            <div className="space-y-2">
              <Label>ملاحظات</Label>
              <Input placeholder="ملاحظات إضافية..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewSettlementDialog(false)}>
              إلغاء
            </Button>
            <Button className="bg-teal-600 hover:bg-teal-700">
              <Calculator className="h-4 w-4 ml-2" />
              حساب وإنشاء التسوية
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

