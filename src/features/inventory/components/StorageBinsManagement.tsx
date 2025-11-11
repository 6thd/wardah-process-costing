import { useState, useEffect } from 'react';
import { Plus, Edit, Trash2, Package, Barcode, MapPin, Lock, Building2, AlertCircle } from 'lucide-react';
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
import { warehouseService, type StorageBin, type Warehouse, type StorageLocation } from '@/services/warehouse-service';

export default function StorageBinsManagement() {
  const [bins, setBins] = useState<StorageBin[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [locations, setLocations] = useState<StorageLocation[]>([]);
  const [selectedWarehouse, setSelectedWarehouse] = useState<string>('');
  const [selectedLocation, setSelectedLocation] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [showDialog, setShowDialog] = useState(false);
  const [editingBin, setEditingBin] = useState<StorageBin | null>(null);
  const [formData, setFormData] = useState<Partial<StorageBin>>({
    bin_code: '',
    barcode: '',
    aisle: '',
    rack: '',
    level: '',
    position: '',
    bin_type: 'PALLET',
    is_occupied: false,
    is_active: true,
    is_locked: false,
  });

  useEffect(() => {
    loadWarehouses();
  }, []);

  useEffect(() => {
    if (selectedWarehouse) {
      loadLocations(selectedWarehouse);
      loadBins(selectedWarehouse);
    }
  }, [selectedWarehouse]);

  useEffect(() => {
    if (selectedLocation) {
      loadBins(selectedWarehouse, selectedLocation);
    } else if (selectedWarehouse) {
      loadBins(selectedWarehouse);
    }
  }, [selectedLocation]);

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
      const data = await warehouseService.getStorageLocations(warehouseId);
      setLocations(data || []);
    } catch (error) {
      console.error('Error loading locations:', error);
    }
  };

  const loadBins = async (warehouseId: string, locationId?: string) => {
    try {
      setLoading(true);
      const data = await warehouseService.getStorageBins(locationId, warehouseId);
      setBins(data || []);
    } catch (error) {
      console.error('Error loading bins:', error);
      toast.error('فشل تحميل صناديق التخزين');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenDialog = (bin?: StorageBin) => {
    if (bin) {
      setEditingBin(bin);
      setFormData(bin);
    } else {
      setEditingBin(null);
      setFormData({
        bin_code: '',
        barcode: '',
        aisle: '',
        rack: '',
        level: '',
        position: '',
        bin_type: 'PALLET',
        is_occupied: false,
        is_active: true,
        is_locked: false,
        warehouse_id: selectedWarehouse,
        location_id: selectedLocation || undefined,
      });
    }
    setShowDialog(true);
  };

  const handleCloseDialog = () => {
    setShowDialog(false);
    setEditingBin(null);
    setFormData({
      bin_code: '',
      barcode: '',
      aisle: '',
      rack: '',
      level: '',
      position: '',
      bin_type: 'PALLET',
      is_occupied: false,
      is_active: true,
      is_locked: false,
    });
  };

  const handleSave = async () => {
    try {
      if (!formData.bin_code || !selectedWarehouse) {
        toast.error('الرجاء إدخال كود الصندوق واختيار المخزن');
        return;
      }

      setLoading(true);

      if (editingBin) {
        await warehouseService.updateStorageBin(editingBin.id, formData);
        toast.success('تم تحديث الصندوق بنجاح');
      } else {
        await warehouseService.createStorageBin({
          ...formData,
          warehouse_id: selectedWarehouse,
          location_id: selectedLocation || formData.location_id,
        });
        toast.success('تم إنشاء الصندوق بنجاح');
      }

      handleCloseDialog();
      loadBins(selectedWarehouse, selectedLocation);
    } catch (error: any) {
      console.error('Error saving bin:', error);
      toast.error(error.message || 'فشل حفظ الصندوق');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('هل أنت متأكد من حذف هذا الصندوق؟')) {
      return;
    }

    try {
      setLoading(true);
      await warehouseService.deleteStorageBin(id);
      toast.success('تم حذف الصندوق بنجاح');
      loadBins(selectedWarehouse, selectedLocation);
    } catch (error: any) {
      console.error('Error deleting bin:', error);
      toast.error(error.message || 'فشل حذف الصندوق');
    } finally {
      setLoading(false);
    }
  };

  const generateBarcode = () => {
    const barcode = `BIN-${Date.now().toString().slice(-8)}`;
    setFormData({ ...formData, barcode });
  };

  const getBinTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      PALLET: 'بالتة',
      SHELF: 'رف',
      FLOOR: 'أرضي',
      RACK: 'حامل',
      DRAWER: 'درج',
      BOX: 'صندوق',
      OTHER: 'أخرى',
    };
    return labels[type] || type;
  };

  const selectedWarehouseData = warehouses.find((w) => w.id === selectedWarehouse);
  const selectedLocationData = locations.find((l) => l.id === selectedLocation);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Package className="h-8 w-8 text-primary" />
            صناديق التخزين
          </h2>
          <p className="text-muted-foreground mt-2">
            إدارة الصناديق والمواقع الدقيقة داخل المخزن (المستوى الثالث)
          </p>
        </div>
        <Button onClick={() => handleOpenDialog()} disabled={!selectedWarehouse}>
          <Plus className="mr-2 h-4 w-4" />
          صندوق جديد
        </Button>
      </div>

      {/* Info Box */}
      <div className="rounded-lg border-2 border-purple-300 bg-purple-50 dark:bg-purple-900/20 p-4">
        <div className="flex items-start gap-3">
          <Package className="h-6 w-6 text-purple-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="font-semibold text-purple-900 dark:text-purple-100 mb-2">
              📦 الهيكل الهرمي الكامل للتخزين
            </h3>
            <div className="text-sm text-purple-800 dark:text-purple-200 space-y-2">
              <div className="flex items-center gap-2 p-2 bg-white/50 rounded">
                <span className="font-bold">المستوى 1:</span>
                <span>🏭 المخزن (Warehouse)</span>
                <Badge variant="secondary" className="text-xs">مثال: WH-001</Badge>
              </div>
              <div className="flex items-center gap-2 p-2 bg-white/50 rounded">
                <span className="font-bold">المستوى 2:</span>
                <span>📍 موقع التخزين (Storage Location)</span>
                <Badge variant="secondary" className="text-xs">مثال: ZONE-A</Badge>
              </div>
              <div className="flex items-center gap-2 p-2 bg-purple-100/50 rounded border-2 border-purple-400">
                <span className="font-bold">المستوى 3:</span>
                <span>📦 صندوق التخزين (Storage Bin)</span>
                <Badge variant="secondary" className="text-xs">مثال: A-01-02-03</Badge>
                <span className="text-xs text-purple-600">← الصفحة الحالية</span>
              </div>
            </div>
            <p className="text-xs text-purple-700 dark:text-purple-300 mt-3">
              💡 <strong>الموقع الدقيق:</strong> Aisle (ممر) - Rack (رف) - Level (مستوى) - Position (موقع)
              <br />
              📱 <strong>الباركود:</strong> كل صندوق له باركود فريد للمسح السريع
            </p>
          </div>
        </div>
      </div>

      {/* Warehouse & Location Selector */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            اختر المخزن والموقع
          </CardTitle>
          <CardDescription>
            اختر المخزن والموقع لعرض وإدارة صناديق التخزين
          </CardDescription>
        </CardHeader>
        <CardContent>
          {warehouses.length === 0 ? (
            <div className="text-center p-8">
              <AlertCircle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
              <p className="text-muted-foreground mb-4">لا توجد مخازن مسجلة في النظام</p>
              <Button variant="outline" onClick={() => window.location.href = '/inventory/warehouses'}>
                <Plus className="mr-2 h-4 w-4" />
                إنشاء مخزن أولاً
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>المخزن *</Label>
                  <Select value={selectedWarehouse} onValueChange={setSelectedWarehouse}>
                    <SelectTrigger>
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
                </div>

                <div className="space-y-2">
                  <Label>الموقع (اختياري)</Label>
                  <Select value={selectedLocation} onValueChange={setSelectedLocation}>
                    <SelectTrigger>
                      <SelectValue placeholder="جميع المواقع" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">جميع المواقع</SelectItem>
                      {locations.map((location) => (
                        <SelectItem key={location.id} value={location.id}>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs">{location.code}</span>
                            <span>{location.name}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {selectedWarehouseData && (
                <div className="flex items-center gap-4 text-sm text-muted-foreground p-3 bg-muted rounded">
                  <Badge variant="outline">{selectedWarehouseData.warehouse_type}</Badge>
                  <span>•</span>
                  <span>{bins.length} صندوق</span>
                  {selectedLocationData && (
                    <>
                      <span>•</span>
                      <MapPin className="h-4 w-4" />
                      <span>{selectedLocationData.name}</span>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bins Table */}
      {selectedWarehouse && (
        <Card>
          <CardHeader>
            <CardTitle>صناديق التخزين</CardTitle>
            <CardDescription>
              {selectedLocationData 
                ? `صناديق الموقع: ${selectedLocationData.name}`
                : `جميع صناديق المخزن: ${selectedWarehouseData?.name}`
              }
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading && !showDialog ? (
              <div className="flex items-center justify-center p-8">
                <div className="text-muted-foreground">جاري التحميل...</div>
              </div>
            ) : bins.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-8 text-center">
                <Package className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">لا توجد صناديق تخزين</p>
                <Button variant="outline" className="mt-4" onClick={() => handleOpenDialog()}>
                  <Plus className="mr-2 h-4 w-4" />
                  إضافة أول صندوق
                </Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>كود الصندوق</TableHead>
                    <TableHead>الباركود</TableHead>
                    <TableHead>الموقع الفيزيائي</TableHead>
                    <TableHead>النوع</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead className="text-left">الإجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bins.map((bin) => (
                    <TableRow key={bin.id}>
                      <TableCell className="font-mono font-bold">
                        {bin.bin_code}
                      </TableCell>
                      <TableCell>
                        {bin.barcode ? (
                          <div className="flex items-center gap-2">
                            <Barcode className="h-4 w-4 text-muted-foreground" />
                            <span className="font-mono text-xs">{bin.barcode}</span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="text-sm space-y-1">
                          {bin.aisle && <div>ممر: <span className="font-mono">{bin.aisle}</span></div>}
                          {bin.rack && <div>رف: <span className="font-mono">{bin.rack}</span></div>}
                          {bin.level && <div>مستوى: <span className="font-mono">{bin.level}</span></div>}
                          {bin.position && <div>موقع: <span className="font-mono">{bin.position}</span></div>}
                          {!bin.aisle && !bin.rack && !bin.level && !bin.position && (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {getBinTypeLabel(bin.bin_type || 'PALLET')}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {bin.is_occupied && (
                            <Badge variant="destructive" className="text-xs">
                              مشغول
                            </Badge>
                          )}
                          {bin.is_locked && (
                            <Badge variant="secondary" className="text-xs">
                              <Lock className="h-3 w-3 mr-1" />
                              مقفل
                            </Badge>
                          )}
                          {!bin.is_active && (
                            <Badge variant="secondary" className="text-xs">
                              غير نشط
                            </Badge>
                          )}
                          {!bin.is_occupied && !bin.is_locked && bin.is_active && (
                            <Badge variant="default" className="text-xs">
                              متاح
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-left">
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleOpenDialog(bin)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDelete(bin.id)}
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
              {editingBin ? 'تعديل صندوق التخزين' : 'صندوق تخزين جديد'}
            </DialogTitle>
            <DialogDescription>
              املأ البيانات التالية لإنشاء أو تحديث صندوق التخزين
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Basic Info */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="bin_code">كود الصندوق *</Label>
                <Input
                  id="bin_code"
                  value={formData.bin_code}
                  onChange={(e) => setFormData({ ...formData, bin_code: e.target.value })}
                  placeholder="A-01-02-03"
                  disabled={!!editingBin}
                />
                <p className="text-xs text-muted-foreground">
                  مثال: A-01-02-03 (ممر-رف-مستوى-موقع)
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="bin_type">نوع الصندوق *</Label>
                <Select
                  value={formData.bin_type}
                  onValueChange={(value) =>
                    setFormData({ ...formData, bin_type: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PALLET">بالتة (Pallet)</SelectItem>
                    <SelectItem value="SHELF">رف (Shelf)</SelectItem>
                    <SelectItem value="FLOOR">أرضي (Floor)</SelectItem>
                    <SelectItem value="RACK">حامل (Rack)</SelectItem>
                    <SelectItem value="DRAWER">درج (Drawer)</SelectItem>
                    <SelectItem value="BOX">صندوق (Box)</SelectItem>
                    <SelectItem value="OTHER">أخرى</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Barcode */}
            <div className="space-y-2">
              <Label htmlFor="barcode">الباركود</Label>
              <div className="flex gap-2">
                <Input
                  id="barcode"
                  value={formData.barcode || ''}
                  onChange={(e) => setFormData({ ...formData, barcode: e.target.value })}
                  placeholder="BIN-12345678"
                  className="flex-1"
                />
                <Button type="button" variant="outline" onClick={generateBarcode}>
                  <Barcode className="h-4 w-4 mr-2" />
                  إنشاء
                </Button>
              </div>
            </div>

            {/* Location if not selected */}
            {!selectedLocation && locations.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="location_id">الموقع</Label>
                <Select
                  value={formData.location_id || ''}
                  onValueChange={(value) =>
                    setFormData({ ...formData, location_id: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="اختر موقع (اختياري)" />
                  </SelectTrigger>
                  <SelectContent>
                    {locations.map((location) => (
                      <SelectItem key={location.id} value={location.id}>
                        {location.code} - {location.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Physical Location */}
            <div className="border rounded-lg p-4 space-y-4">
              <h4 className="font-medium flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                الموقع الفيزيائي الدقيق
              </h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="aisle">الممر (Aisle)</Label>
                  <Input
                    id="aisle"
                    value={formData.aisle || ''}
                    onChange={(e) => setFormData({ ...formData, aisle: e.target.value })}
                    placeholder="A, B, C..."
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="rack">الرف (Rack)</Label>
                  <Input
                    id="rack"
                    value={formData.rack || ''}
                    onChange={(e) => setFormData({ ...formData, rack: e.target.value })}
                    placeholder="01, 02, 03..."
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="level">المستوى (Level)</Label>
                  <Input
                    id="level"
                    value={formData.level || ''}
                    onChange={(e) => setFormData({ ...formData, level: e.target.value })}
                    placeholder="01, 02, 03..."
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="position">الموقع (Position)</Label>
                  <Input
                    id="position"
                    value={formData.position || ''}
                    onChange={(e) => setFormData({ ...formData, position: e.target.value })}
                    placeholder="01, 02, 03..."
                  />
                </div>
              </div>
            </div>

            {/* Settings */}
            <div className="space-y-4">
              <div className="flex items-center space-x-2 space-x-reverse">
                <Checkbox
                  id="is_occupied"
                  checked={formData.is_occupied}
                  onCheckedChange={(checked) =>
                    setFormData({ ...formData, is_occupied: !!checked })
                  }
                />
                <Label htmlFor="is_occupied" className="cursor-pointer">
                  صندوق مشغول (Occupied)
                </Label>
              </div>

              <div className="flex items-center space-x-2 space-x-reverse">
                <Checkbox
                  id="is_locked"
                  checked={formData.is_locked}
                  onCheckedChange={(checked) =>
                    setFormData({ ...formData, is_locked: !!checked })
                  }
                />
                <Label htmlFor="is_locked" className="cursor-pointer flex items-center gap-2">
                  <Lock className="h-4 w-4" />
                  صندوق مقفل (Locked) - لا يمكن الصرف أو الاستلام
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
                  صندوق نشط
                </Label>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleCloseDialog} disabled={loading}>
              إلغاء
            </Button>
            <Button onClick={handleSave} disabled={loading}>
              {loading ? 'جاري الحفظ...' : editingBin ? 'تحديث' : 'إنشاء'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
