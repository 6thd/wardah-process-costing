/**
 * Warehouse Selector Component
 * محدد المخزن مع عرض معلومات الرصيد
 */

import { useState, useEffect } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { getWarehouses, type Warehouse } from '@/services/stock-ledger-service';
import { Loader2, Warehouse as WarehouseIcon } from 'lucide-react';

interface WarehouseSelectorProps {
  readonly value: string;
  readonly onChange: (warehouseId: string) => void;
  readonly label?: string;
  readonly required?: boolean;
  readonly disabled?: boolean;
  readonly showLabel?: boolean;
  readonly className?: string;
}

export function WarehouseSelector({
  value,
  onChange,
  label = 'المخزن',
  required = false,
  disabled = false,
  showLabel = true,
  className = ''
}: WarehouseSelectorProps) {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadWarehouses();
  }, []);

  const loadWarehouses = async () => {
    setLoading(true);
    try {
      const result = await getWarehouses();
      if (result.success && result.data) {
        setWarehouses(result.data);
        
        // Auto-select first warehouse if none selected
        if (!value && result.data.length > 0) {
          onChange(result.data[0].id);
        }
      }
    } catch (error) {
      console.error('Error loading warehouses:', error);
    } finally {
      setLoading(false);
    }
  };

  const selectedWarehouse = warehouses.find(w => w.id === value);

  return (
    <div className={className}>
      {showLabel && (
        <Label className="mb-2 flex items-center gap-2">
          <WarehouseIcon className="h-4 w-4" />
          {label}
          {required && <span className="text-red-500">*</span>}
        </Label>
      )}
      
      {loading ? (
        <div className="flex items-center justify-center h-10 border rounded-md bg-gray-50">
          <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
          <span className="mr-2 text-sm text-gray-500">جاري التحميل...</span>
        </div>
      ) : (
        <Select value={value} onValueChange={onChange} disabled={disabled}>
          <SelectTrigger className="text-right">
            <SelectValue placeholder="اختر المخزن">
              {selectedWarehouse && (
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm text-gray-500">
                    {selectedWarehouse.code}
                  </span>
                  <span>-</span>
                  <span>{selectedWarehouse.name_ar || selectedWarehouse.name}</span>
                  <span className="text-xs text-gray-400">
                    ({selectedWarehouse.warehouse_type})
                  </span>
                </div>
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {warehouses.map((warehouse) => (
              <SelectItem key={warehouse.id} value={warehouse.id}>
                <div className="flex items-center gap-2 text-right">
                  <span className="font-mono text-sm text-gray-500">
                    {warehouse.code}
                  </span>
                  <span>-</span>
                  <span>{warehouse.name_ar || warehouse.name}</span>
                  <span className="text-xs text-gray-400">
                    ({warehouse.warehouse_type})
                  </span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {selectedWarehouse && (
        <p className="mt-1 text-xs text-gray-500">
          {selectedWarehouse.warehouse_type === 'Stores' && '📦 مخزن رئيسي'}
          {selectedWarehouse.warehouse_type === 'Transit' && '🚚 مخزن نقل'}
          {selectedWarehouse.warehouse_type === 'Scrap' && '♻️ مخزن مرفوضات'}
          {selectedWarehouse.warehouse_type === 'Work-In-Progress' && '⚙️ قيد التصنيع'}
        </p>
      )}
    </div>
  );
}
