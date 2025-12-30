import { useState, useEffect } from 'react';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { Plus, Edit, Trash2, MapPin, Thermometer, Building2, AlertCircle } from 'lucide-react';
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
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { warehouseService, type StorageLocation, type Warehouse } from '@/services/warehouse-service';

export default function StorageLocationsManagement() {
  const [locations, setLocations] = useState<StorageLocation[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [selectedWarehouse, setSelectedWarehouse] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [showDialog, setShowDialog] = useState(false);
  const [editingLocation, setEditingLocation] = useState<StorageLocation | null>(null);
  const [formData, setFormData] = useState<Partial<StorageLocation>>({
    code: '',
    name: '',
    name_ar: '',
    location_type: 'ZONE',
    temperature_controlled: false,
    is_active: true,
    is_pickable: true,
    is_receivable: true,
  });

  useEffect(() => {
    loadWarehouses();
  }, []);

  useEffect(() => {
    if (selectedWarehouse) {
      loadLocations(selectedWarehouse);
    }
  }, [selectedWarehouse]);

  const loadWarehouses = async () => {
    try {
      const data = await warehouseService.getWarehouses();
      setWarehouses(data || []);
      if (data && data.length > 0) {
        setSelectedWarehouse(data[0].id);
      }
    } catch (error) {
      console.error('Error loading warehouses:', error);
      toast.error('فشل تحميل المخازن');
    }
  };

  const loadLocations = async (warehouseId: string) => {
    try {
      setLoading(true);
      const data = await warehouseService.getStorageLocations(warehouseId);
      setLocations(data || []);
    } catch (error) {
      console.error('Error loading locations:', error);
      toast.error('فشل تحميل مواقع التخزين');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenDialog = (location?: StorageLocation) => {
    if (location) {
      setEditingLocation(location);
      setFormData(location);
    } else {
      setEditingLocation(null);
      setFormData({
        code: '',
        name: '',
        name_ar: '',
        location_type: 'ZONE',
        temperature_controlled: false,
        is_active: true,
        is_pickable: true,
        is_receivable: true,
        warehouse_id: selectedWarehouse,
      });
    }
    setShowDialog(true);
  };

  const handleCloseDialog = () => {
    setShowDialog(false);
    setEditingLocation(null);
    setFormData({
      code: '',
      name: '',
      name_ar: '',
      location_type: 'ZONE',
      temperature_controlled: false,
      is_active: true,
      is_pickable: true,
      is_receivable: true,
    });
  };

  const handleSave = async () => {
    try {
      if (!formData.code || !formData.name || !selectedWarehouse) {
        toast.error('الرجاء إدخال الكود والاسم واختيار المخزن');
        return;
      }

      setLoading(true);

      if (editingLocation) {
        await warehouseService.updateStorageLocation(editingLocation.id, formData);
        toast.success('تم تحديث الموقع بنجاح');
      } else {
        await warehouseService.createStorageLocation({
          ...formData,
          warehouse_id: selectedWarehouse,
        });
        toast.success('تم إنشاء الموقع بنجاح');
      }

      handleCloseDialog();
      loadLocations(selectedWarehouse);
    } catch (error: any) {
      console.error('Error saving location:', error);
      toast.error(error.message || 'فشل حفظ الموقع');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('هل أنت متأكد من حذف هذا الموقع؟')) {
      return;
    }

    try {
      setLoading(true);
      await warehouseService.deleteStorageLocation(id);
      toast.success('تم حذف الموقع بنجاح');
      loadLocations(selectedWarehouse);
    } catch (error: any) {
      console.error('Error deleting location:', error);
      toast.error(error.message || 'فشل حذف الموقع');
    } finally {
      setLoading(false);
    }
  };

  const getLocationTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      ZONE: 'منطقة',
      RACK: 'رف',
      SHELF: 'رف فرعي',
      AREA: 'منطقة عامة',
      COLD_STORAGE: 'تخزين بارد',
      RECEIVING: 'استلام',
      SHIPPING: 'شحن',
      QUARANTINE: 'حجر صحي',
      OTHER: 'أخرى',
    };
    return labels[type] || type;
  };

  const selectedWarehouseData = warehouses.find((w) => w.id === selectedWarehouse);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <MapPin className="h-8 w-8 text-primary" />
            مواقع التخزين
          </h2>
          <p className="text-muted-foreground mt-2">
            إدارة المناطق والأرفف داخل كل مخزن (المستوى الثاني)
          </p>
        </div>
        <Button onClick={() => handleOpenDialog()} disabled={!selectedWarehouse}>
          <Plus className="mr-2 h-4 w-4" />
          موقع جديد
        </Button>
      </div>

      {/* Info Box */}
      <div className="rounded-lg border-2 border-blue-300 bg-blue-50 dark:bg-blue-900/20 p-4">
        <div className="flex items-start gap-3">
          <Building2 className="h-6 w-6 text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="font-semibold text-blue-900 dark:text-blue-100 mb-2">
              📍 الهيكل الهرمي للتخزين
            </h3>
            <div className="text-sm text-blue-800 dark:text-blue-200 space-y-2">
              <div className="flex items-center gap-2 p-2 bg-white/50 rounded">
                <span className="font-bold">المستوى 1:</span>
                <span>🏭 المخزن (Warehouse)</span>
                <span className="text-xs text-blue-600">← مرتبط بالحسابات المحاسبية</span>
              </div>
              <div className="flex items-center gap-2 p-2 bg-blue-100/50 rounded border-2 border-blue-400">
                <span className="font-bold">المستوى 2:</span>
                <span>📍 موقع التخزين (Storage Location)</span>
                <span className="text-xs text-blue-600">← الصفحة الحالية</span>
              </div>
              <div className="flex items-center gap-2 p-2 bg-white/50 rounded">
                <span className="font-bold">المستوى 3:</span>
                <span>📦 صندوق التخزين (Storage Bin)</span>
                <span className="text-xs text-blue-600">← مع باركود وموقع دقيق</span>
              </div>
            </div>
            <p className="text-xs text-blue-700 dark:text-blue-300 mt-3">
              💡 <strong>مثال:</strong> المخزن الرئيسي → Zone A (Raw Materials) → Bin A-01-01
            </p>
          </div>
        </div>
      </div>

      {/* Warehouse Selector */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            اختر المخزن
          </CardTitle>
          <CardDescription>
            اختر المخزن لعرض وإدارة مواقع التخزين داخله
          </CardDescription>
        </CardHeader>
        <CardContent>
          {warehouses.length === 0 ? (
            <div className="text-center p-8">
              <AlertCircle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
              <p className="text-muted-foreground mb-4">لا توجد مخازن مسجلة في النظام</p>
              {/* eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, sonarjs/prefer-global-this */}
              <Button variant="outline" onClick={() => { globalThis.window.location.href = '/inventory/warehouses'; }}>
                <Plus className="mr-2 h-4 w-4" />
                إنشاء مخزن أولاً
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-4">
              <Select value={selectedWarehouse} onValueChange={setSelectedWarehouse}>
                <SelectTrigger className="w-full max-w-md">
                  <SelectValue placeholder="اختر مخزن" />
                </SelectTrigger>
                <SelectContent>
                  {warehouses.map((warehouse) => (
                    <SelectItem key={warehouse.id} value={warehouse.id}>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs">{warehouse.code}</span>
                        <span>{warehouse.name}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedWarehouseData && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Badge variant="outline">{selectedWarehouseData.warehouse_type}</Badge>
                  <span>•</span>
                  <span>{locations.length} موقع</span>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Locations Table */}
      {selectedWarehouse && (
        <Card>
          <CardHeader>
            <CardTitle>مواقع التخزين في {selectedWarehouseData?.name}</CardTitle>
            <CardDescription>
              المناطق والأرفف المسجلة داخل المخزن
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* eslint-disable-next-line sonarjs/prefer-immediate-return, complexity, sonarjs/no-nested-template-literals, sonarjs/no-nested-conditional */}
            {(() => {
              if (loading && !showDialog) {
                return (
                  <div className="flex items-center justify-center p-8">
                    <div className="text-muted-foreground">جاري التحميل...</div>
                  </div>
                );
              }
              if (locations.length === 0) {
                return (
                  <div className="flex flex-col items-center justify-center p-8 text-center">
                    <MapPin className="h-12 w-12 text-muted-foreground mb-4" />
                    <p className="text-muted-foreground">لا توجد مواقع تخزين في هذا المخزن</p>
                    <Button variant="outline" className="mt-4" onClick={() => handleOpenDialog()}>
                      <Plus className="mr-2 h-4 w-4" />
                      إضافة أول موقع
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
                    <TableHead>الميزات</TableHead>
                    <TableHead>السعة</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead className="text-left">الإجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {locations.map((location) => (
                    <TableRow key={location.id}>
                      <TableCell className="font-mono text-sm">
                        {location.code}
                      </TableCell>
                      <TableCell>
                        <div>
                          <div className="font-medium">{location.name}</div>
                          {location.name_ar && (
                            <div className="text-sm text-muted-foreground">
                              {location.name_ar}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {getLocationTypeLabel(location.location_type || 'ZONE')}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {location.temperature_controlled && (
                            <Badge variant="secondary" className="text-xs">
                              <Thermometer className="h-3 w-3 mr-1" />
                              تبريد
                            </Badge>
                          )}
                          {location.is_pickable && (
                            <Badge variant="secondary" className="text-xs">
                              صرف
                            </Badge>
                          )}
                          {location.is_receivable && (
                            <Badge variant="secondary" className="text-xs">
                              استلام
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {location.capacity ? (
                          <span className="text-sm">
                            {location.capacity} {location.capacity_unit || ''}
                          </span>
                        ) : (
                          <span className="text-sm text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {location.is_active ? (
                          <Badge variant="default">نشط</Badge>
                        ) : (
                          <Badge variant="secondary">غير نشط</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-left">
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleOpenDialog(location)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDelete(location.id)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingLocation ? 'تعديل موقع التخزين' : 'موقع تخزين جديد'}
            </DialogTitle>
            <DialogDescription>
              املأ البيانات التالية لإنشاء أو تحديث موقع التخزين داخل المخزن
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Basic Info */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="code">الكود *</Label>
                <Input
                  id="code"
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                  placeholder="ZONE-A, RACK-01"
                  disabled={!!editingLocation}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="location_type">نوع الموقع *</Label>
                <Select
                  value={formData.location_type}
                  onValueChange={(value) =>
                    setFormData({ ...formData, location_type: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ZONE">منطقة (Zone)</SelectItem>
                    <SelectItem value="RACK">رف (Rack)</SelectItem>
                    <SelectItem value="SHELF">رف فرعي (Shelf)</SelectItem>
                    <SelectItem value="AREA">منطقة عامة (Area)</SelectItem>
                    <SelectItem value="COLD_STORAGE">تخزين بارد</SelectItem>
                    <SelectItem value="RECEIVING">منطقة استلام</SelectItem>
                    <SelectItem value="SHIPPING">منطقة شحن</SelectItem>
                    <SelectItem value="QUARANTINE">حجر صحي</SelectItem>
                    <SelectItem value="OTHER">أخرى</SelectItem>
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
                placeholder="Zone A - Raw Materials"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="name_ar">الاسم (عربي)</Label>
              <Input
                id="name_ar"
                value={formData.name_ar || ''}
                onChange={(e) => setFormData({ ...formData, name_ar: e.target.value })}
                placeholder="المنطقة أ - المواد الخام"
              />
            </div>

            {/* Capacity */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="capacity">السعة</Label>
                <Input
                  id="capacity"
                  type="number"
                  value={formData.capacity || ''}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      capacity: Number.parseFloat(e.target.value) || undefined,
                    })
                  }
                  placeholder="100"
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
                  placeholder="طن / م³ / وحدة"
                />
              </div>
            </div>

            {/* Settings */}
            <div className="space-y-4">
              <div className="flex items-center space-x-2 space-x-reverse">
                <Checkbox
                  id="temperature_controlled"
                  checked={formData.temperature_controlled}
                  onCheckedChange={(checked) =>
                    setFormData({ ...formData, temperature_controlled: !!checked })
                  }
                />
                <Label htmlFor="temperature_controlled" className="cursor-pointer flex items-center gap-2">
                  <Thermometer className="h-4 w-4" />
                  موقع مُبرد (Temperature Controlled)
                </Label>
              </div>

              <div className="flex items-center space-x-2 space-x-reverse">
                <Checkbox
                  id="is_pickable"
                  checked={formData.is_pickable}
                  onCheckedChange={(checked) =>
                    setFormData({ ...formData, is_pickable: !!checked })
                  }
                />
                <Label htmlFor="is_pickable" className="cursor-pointer">
                  يمكن الصرف منه (Pickable)
                </Label>
              </div>

              <div className="flex items-center space-x-2 space-x-reverse">
                <Checkbox
                  id="is_receivable"
                  checked={formData.is_receivable}
                  onCheckedChange={(checked) =>
                    setFormData({ ...formData, is_receivable: !!checked })
                  }
                />
                <Label htmlFor="is_receivable" className="cursor-pointer">
                  يمكن الاستلام فيه (Receivable)
                </Label>
              </div>

              <div className="flex items-center space-x-2 space-x-reverse">
                <Checkbox
                  id="is_active"
                  checked={formData.is_active}
                  onCheckedChange={(checked) =>
                    setFormData({ ...formData, is_active: !!checked })
                  }
                />
                <Label htmlFor="is_active" className="cursor-pointer">
                  موقع نشط
                </Label>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleCloseDialog} disabled={loading}>
              إلغاء
            </Button>
            <Button onClick={handleSave} disabled={loading}>
              {/* eslint-disable-next-line sonarjs/prefer-immediate-return, complexity, sonarjs/no-nested-template-literals, sonarjs/no-nested-conditional */}
              {(() => {
                if (loading) return 'جاري الحفظ...';
                return editingLocation ? 'تحديث' : 'إنشاء';
              })()}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
