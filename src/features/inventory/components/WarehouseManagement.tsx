import { useState, useEffect } from 'react';
import { Plus, Edit, Trash2, Warehouse, MapPin, Package, Settings, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import AccountPicker from './AccountPicker';
import { warehouseService, type Warehouse as WarehouseType } from '@/services/warehouse-service';

export default function WarehouseManagement() {
  const [warehouses, setWarehouses] = useState<WarehouseType[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDialog, setShowDialog] = useState(false);
  const [editingWarehouse, setEditingWarehouse] = useState<WarehouseType | null>(null);
  const [activeTab, setActiveTab] = useState('basic');
  const [formData, setFormData] = useState<Partial<WarehouseType>>({
    code: '',
    name: '',
    name_ar: '',
    warehouse_type: 'MAIN',
    is_active: true,
    is_group: false,
    allow_negative_stock: false,
  });

  useEffect(() => {
    loadWarehouses();
  }, []);

  const loadWarehouses = async () => {
    try {
      setLoading(true);
      const data = await warehouseService.getWarehouses(true);
      setWarehouses(data || []);
    } catch (error) {
      console.error('Error loading warehouses:', error);
      toast.error('فشل تحميل المخازن');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenDialog = (warehouse?: WarehouseType) => {
    if (warehouse) {
      setEditingWarehouse(warehouse);
      setFormData(warehouse);
      // إذا كان المخزن غير مرتبط بالحسابات، افتح تبويب الحسابات مباشرة
      if (!warehouse.inventory_account_id || !warehouse.expense_account_id) {
        setActiveTab('accounting');
      } else {
        setActiveTab('basic');
      }
    } else {
      setEditingWarehouse(null);
      setActiveTab('basic');
      setFormData({
        code: '',
        name: '',
        name_ar: '',
        warehouse_type: 'MAIN',
        is_active: true,
        is_group: false,
        allow_negative_stock: false,
      });
    }
    setShowDialog(true);
  };

  const handleCloseDialog = () => {
    setShowDialog(false);
    setEditingWarehouse(null);
    setActiveTab('basic');
    setFormData({
      code: '',
      name: '',
      name_ar: '',
      warehouse_type: 'MAIN',
      is_active: true,
      is_group: false,
      allow_negative_stock: false,
    });
  };

  const handleSave = async () => {
    try {
      if (!formData.code || !formData.name) {
        toast.error('الرجاء إدخال الكود والاسم');
        return;
      }

      setLoading(true);

      if (editingWarehouse) {
        await warehouseService.updateWarehouse(editingWarehouse.id, formData);
        toast.success('تم تحديث المخزن بنجاح');
      } else {
        await warehouseService.createWarehouse(formData);
        toast.success('تم إنشاء المخزن بنجاح');
      }

      handleCloseDialog();
      loadWarehouses();
    } catch (error: unknown) {
      // eslint-disable-next-line no-console
      console.error('Error saving warehouse:', error);
      const errorMessage = error instanceof Error ? error.message : 'فشل حفظ المخزن';
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('هل أنت متأكد من حذف هذا المخزن؟')) {
      return;
    }

    try {
      setLoading(true);
      await warehouseService.deleteWarehouse(id);
      toast.success('تم حذف المخزن بنجاح');
      loadWarehouses();
    } catch (error: unknown) {
      // eslint-disable-next-line no-console
      console.error('Error deleting warehouse:', error);
      const errorMessage = error instanceof Error ? error.message : 'فشل حذف المخزن';
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const renderWarehouseContent = () => {
    if (loading && !showDialog) {
      return (
        <div className="flex items-center justify-center p-8">
          <div className="text-muted-foreground">جاري التحميل...</div>
        </div>
      );
    }
    if (warehouses.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center p-8 text-center">
          <Warehouse className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-muted-foreground">لا توجد مخازن مسجلة</p>
          <Button variant="outline" className="mt-4" onClick={() => handleOpenDialog()}>
            <Plus className="mr-2 h-4 w-4" />
            إضافة أول مخزن
          </Button>
        </div>
      );
    }
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>الكود</TableHead>
            <TableHead>الاسم</TableHead>
            <TableHead>النوع</TableHead>
            <TableHead>حساب المخزون</TableHead>
            <TableHead>حساب المصروفات</TableHead>
            <TableHead>الحالة</TableHead>
            <TableHead className="text-start">الإجراءات</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {warehouses.map((warehouse) => (
            <TableRow key={warehouse.id}>
              <TableCell className="font-mono text-sm">
                {warehouse.code}
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <div>
                    <div className="font-medium flex items-center gap-2">
                      {warehouse.name}
                      {(!warehouse.inventory_account_id || !warehouse.expense_account_id) && (
                        <AlertCircle className="h-4 w-4 text-amber-500" />
                      )}
                    </div>
                    {warehouse.name_ar && (
                      <div className="text-sm text-muted-foreground">
                        {warehouse.name_ar}
                      </div>
                    )}
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <Badge variant="outline">
                  {getWarehouseTypeLabel(warehouse.warehouse_type)}
                </Badge>
              </TableCell>
              <TableCell>
                {warehouse.inventory_account_id ? (
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-green-500" />
                    <span className="text-sm">مرتبط</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-amber-500" />
                    <span className="text-sm text-amber-600">غير مرتبط</span>
                  </div>
                )}
              </TableCell>
              <TableCell>
                {warehouse.expense_account_id ? (
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-green-500" />
                    <span className="text-sm">مرتبط</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-amber-500" />
                    <span className="text-sm text-amber-600">غير مرتبط</span>
                  </div>
                )}
              </TableCell>
              <TableCell>
                {warehouse.is_active ? (
                  <Badge variant="default">نشط</Badge>
                ) : (
                  <Badge variant="secondary">غير نشط</Badge>
                )}
              </TableCell>
              <TableCell className="text-start">
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleOpenDialog(warehouse)}
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(warehouse.id)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  };

  const getWarehouseTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      MAIN: 'رئيسي',
      BRANCH: 'فرع',
      PRODUCTION: 'إنتاج',
      TRANSIT: 'عبور',
      RETAIL: 'بيع بالتجزئة',
      VIRTUAL: 'افتراضي',
    };
    return labels[type] || type;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">إدارة المخازن</h2>
          <p className="text-muted-foreground">
            إدارة المخازن ومواقع التخزين مع ربطها بشجرة الحسابات
          </p>
        </div>
        <Button onClick={() => handleOpenDialog()}>
          <Plus className="mr-2 h-4 w-4" />
          مخزن جديد
        </Button>
      </div>

      {/* Warning for unlinked warehouses */}
      {warehouses.some(w => !w.inventory_account_id || !w.expense_account_id) && (
        <div className="rounded-lg border-2 border-amber-300 bg-amber-50 dark:bg-amber-900/20 p-4">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0">
              <AlertCircle className="h-6 w-6 text-amber-600" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-amber-900 dark:text-amber-200 mb-2 text-lg">
                ⚠️ مخازن غير مرتبطة بالحسابات المحاسبية
              </h3>
              <p className="text-sm text-amber-800 dark:text-amber-300 mb-3">
                يوجد <strong>{warehouses.filter(w => !w.inventory_account_id || !w.expense_account_id).length} مخزن</strong> غير مرتبط بشجرة الحسابات. 
                يجب ربط كل مخزن بحساب المخزون وحساب المصروفات لضمان عمل النظام المحاسبي بشكل صحيح.
              </p>
              <div className="flex flex-wrap gap-2 mb-2">
                {warehouses
                  .filter(w => !w.inventory_account_id || !w.expense_account_id)
                  .slice(0, 3)
                  .map((w) => (
                    <Button
                      key={w.id}
                      size="sm"
                      variant="outline"
                      className="border-amber-300 hover:bg-amber-100"
                      onClick={() => handleOpenDialog(w)}
                    >
                      <Edit className="h-3 w-3 mr-1" />
                      {w.code} - {w.name}
                    </Button>
                  ))}
              </div>
              <p className="text-xs text-amber-700 dark:text-amber-400">
                💡 اضغط على اسم المخزن أعلاه أو زر التعديل ✏️ في الجدول، ثم انتقل لتبويب "الحسابات المحاسبية"
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Warehouses Table */}
      <Card>
        <CardHeader>
          <CardTitle>المخازن</CardTitle>
          <CardDescription>
            قائمة جميع المخازن المسجلة في النظام
          </CardDescription>
        </CardHeader>
        <CardContent>
          {renderWarehouseContent()}
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingWarehouse ? 'تعديل المخزن' : 'مخزن جديد'}
            </DialogTitle>
            <DialogDescription>
              املأ البيانات التالية لإنشاء أو تحديث المخزن
            </DialogDescription>
          </DialogHeader>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="basic">
                <Package className="mr-2 h-4 w-4" />
                البيانات الأساسية
              </TabsTrigger>
              <TabsTrigger value="accounting">
                <Settings className="mr-2 h-4 w-4" />
                الحسابات المحاسبية
                {editingWarehouse && (!editingWarehouse.inventory_account_id || !editingWarehouse.expense_account_id) && (
                  <AlertCircle className="mr-1 h-3 w-3 text-amber-500" />
                )}
              </TabsTrigger>
              <TabsTrigger value="details">
                <MapPin className="mr-2 h-4 w-4" />
                التفاصيل
              </TabsTrigger>
            </TabsList>

            {/* Basic Info Tab */}
            <TabsContent value="basic" className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="code">الكود *</Label>
                  <Input
                    id="code"
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                    placeholder="WH-001"
                    disabled={!!editingWarehouse}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="warehouse_type">نوع المخزن *</Label>
                  <Select
                    value={formData.warehouse_type}
                    onValueChange={(value) =>
                      setFormData({ ...formData, warehouse_type: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MAIN">رئيسي</SelectItem>
                      <SelectItem value="BRANCH">فرع</SelectItem>
                      <SelectItem value="PRODUCTION">إنتاج</SelectItem>
                      <SelectItem value="TRANSIT">عبور</SelectItem>
                      <SelectItem value="RETAIL">بيع بالتجزئة</SelectItem>
                      <SelectItem value="VIRTUAL">افتراضي</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="name">الاسم (English) *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Main Warehouse"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="name_ar">الاسم (عربي)</Label>
                <Input
                  id="name_ar"
                  value={formData.name_ar || ''}
                  onChange={(e) => setFormData({ ...formData, name_ar: e.target.value })}
                  placeholder="المخزن الرئيسي"
                />
              </div>

              <div className="space-y-4">
                <div className="flex items-center space-x-2 space-x-reverse">
                  <Checkbox
                    id="is_active"
                    checked={formData.is_active}
                    onCheckedChange={(checked) =>
                      setFormData({ ...formData, is_active: !!checked })
                    }
                  />
                  <Label htmlFor="is_active" className="cursor-pointer">
                    مخزن نشط
                  </Label>
                </div>

                <div className="flex items-center space-x-2 space-x-reverse">
                  <Checkbox
                    id="is_group"
                    checked={formData.is_group}
                    onCheckedChange={(checked) =>
                      setFormData({ ...formData, is_group: !!checked })
                    }
                  />
                  <Label htmlFor="is_group" className="cursor-pointer">
                    مخزن مجموعة (يحتوي على مخازن فرعية)
                  </Label>
                </div>

                <div className="flex items-center space-x-2 space-x-reverse">
                  <Checkbox
                    id="allow_negative_stock"
                    checked={formData.allow_negative_stock}
                    onCheckedChange={(checked) =>
                      setFormData({ ...formData, allow_negative_stock: !!checked })
                    }
                  />
                  <Label htmlFor="allow_negative_stock" className="cursor-pointer">
                    السماح بالرصيد السالب
                  </Label>
                </div>
              </div>
            </TabsContent>

            {/* Accounting Tab */}
            <TabsContent value="accounting" className="space-y-4">
              <div className="rounded-lg border-2 border-blue-300 bg-blue-50 dark:bg-blue-900/20 p-4 mb-4">
                <div className="flex items-start gap-3">
                  <Settings className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-semibold text-blue-900 dark:text-blue-100 mb-2">
                      🔗 ربط المخزن بشجرة الحسابات
                    </h4>
                    <p className="text-sm text-blue-800 dark:text-blue-200 mb-2">
                      <strong>مهم جداً:</strong> اختر الحسابات المناسبة من شجرة الحسابات لربط
                      المخزن بالنظام المحاسبي. بدون هذا الربط لن تعمل التسويات والقيود المحاسبية.
                    </p>
                    <ul className="text-xs text-blue-700 dark:text-blue-300 space-y-1 list-disc list-inside">
                      <li>حساب المخزون: يُستخدم لتسجيل قيمة البضاعة في المخزن (أصول)</li>
                      <li>حساب المصروفات: يُستخدم لتسجيل تسويات وتلفيات المخزون</li>
                      <li>يمكنك تغيير هذه الحسابات لاحقاً إذا لزم الأمر</li>
                    </ul>
                  </div>
                </div>
              </div>

              <AccountPicker
                label="🏦 حساب المخزون (أصول) *"
                value={formData.inventory_account_id}
                onValueChange={(value) =>
                  setFormData({ ...formData, inventory_account_id: value })
                }
                category="ASSET"
                placeholder="اختر حساب المخزون من الأصول (مثل: 1400 - المخزون)"
                showSuggested={true}
              />

              <AccountPicker
                label="💰 حساب مصروفات المخزون *"
                value={formData.expense_account_id}
                onValueChange={(value) =>
                  setFormData({ ...formData, expense_account_id: value })
                }
                category="EXPENSE"
                placeholder="اختر حساب المصروفات (مثل: 5950 - تسويات المخزون)"
                showSuggested={true}
              />

              <div className="rounded-lg border border-muted p-4 bg-muted/50">
                <h4 className="font-medium mb-3 flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  الحسابات المقترحة حسب نوع المخزن:
                </h4>
                <div className="grid grid-cols-1 gap-3 text-sm">
                  <div className="p-3 rounded bg-background border">
                    <div className="font-medium text-green-600 mb-1">✅ مخزن رئيسي / فرع:</div>
                    <ul className="text-muted-foreground space-y-1 text-xs">
                      <li>• حساب المخزون: <span className="font-mono">1400</span> - المخزون</li>
                      <li>• حساب المصروفات: <span className="font-mono">5950</span> - تسويات المخزون</li>
                    </ul>
                  </div>
                  <div className="p-3 rounded bg-background border">
                    <div className="font-medium text-blue-600 mb-1">🏭 مخزن إنتاج:</div>
                    <ul className="text-muted-foreground space-y-1 text-xs">
                      <li>• حساب المخزون: <span className="font-mono">1430</span> - مخزون تحت التشغيل</li>
                      <li>• حساب المصروفات: <span className="font-mono">5100</span> - تكاليف الإنتاج</li>
                    </ul>
                  </div>
                  <div className="p-3 rounded bg-background border">
                    <div className="font-medium text-purple-600 mb-1">🚚 مخزن عبور:</div>
                    <ul className="text-muted-foreground space-y-1 text-xs">
                      <li>• حساب المخزون: <span className="font-mono">1450</span> - بضاعة في الطريق</li>
                      <li>• حساب المصروفات: <span className="font-mono">5950</span> - تسويات المخزون</li>
                    </ul>
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* Details Tab */}
            <TabsContent value="details" className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="city">المدينة</Label>
                  <Input
                    id="city"
                    value={formData.city || ''}
                    onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                    placeholder="الرياض"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="country">الدولة</Label>
                  <Input
                    id="country"
                    value={formData.country || ''}
                    onChange={(e) => setFormData({ ...formData, country: e.target.value })}
                    placeholder="Saudi Arabia"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="address">العنوان</Label>
                <Input
                  id="address"
                  value={formData.address || ''}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  placeholder="شارع، حي، مدينة"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="manager_name">اسم المسؤول</Label>
                  <Input
                    id="manager_name"
                    value={formData.manager_name || ''}
                    onChange={(e) =>
                      setFormData({ ...formData, manager_name: e.target.value })
                    }
                    placeholder="أحمد محمد"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="contact_phone">رقم الهاتف</Label>
                  <Input
                    id="contact_phone"
                    value={formData.contact_phone || ''}
                    onChange={(e) =>
                      setFormData({ ...formData, contact_phone: e.target.value })
                    }
                    placeholder="+966 50 123 4567"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="contact_email">البريد الإلكتروني</Label>
                <Input
                  id="contact_email"
                  type="email"
                  value={formData.contact_email || ''}
                  onChange={(e) =>
                    setFormData({ ...formData, contact_email: e.target.value })
                  }
                  placeholder="warehouse@example.com"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="total_capacity">السعة الإجمالية</Label>
                  <Input
                    id="total_capacity"
                    type="number"
                    value={formData.total_capacity || ''}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        total_capacity: Number.parseFloat(e.target.value) || undefined,
                      })
                    }
                    placeholder="1000"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="capacity_unit">وحدة السعة</Label>
                  <Input
                    id="capacity_unit"
                    value={formData.capacity_unit || ''}
                    onChange={(e) =>
                      setFormData({ ...formData, capacity_unit: e.target.value })
                    }
                    placeholder="متر مربع / طن"
                  />
                </div>
              </div>
            </TabsContent>
          </Tabs>

          <DialogFooter>
            <Button variant="outline" onClick={handleCloseDialog} disabled={loading}>
              إلغاء
            </Button>
            <Button onClick={handleSave} disabled={loading}>
              {(() => {
                if (loading) return 'جاري الحفظ...';
                return editingWarehouse ? 'تحديث' : 'إنشاء';
              })()}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
