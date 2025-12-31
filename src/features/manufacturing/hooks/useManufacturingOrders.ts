import { useState, useEffect } from 'react';
import { manufacturingService } from '@/services/supabase-service';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { ManufacturingOrder } from '@/lib/supabase';

export function useManufacturingOrders() {
  const { t } = useTranslation();
  const [orders, setOrders] = useState<ManufacturingOrder[]>([]);
  const [loading, setLoading] = useState(true);

  const loadOrders = async () => {
    try {
      const data = await manufacturingService.getAll();
      // Convert OrderWithItem[] to ManufacturingOrder[]
      const orders = (data || []) as unknown as ManufacturingOrder[];
      setOrders(orders);
    } catch (error: any) {
      if (error.code === 'PGRST205' || error.message?.includes('Could not find the table')) {
        console.warn('manufacturing_orders table not found, using empty array');
        setOrders([]);
      } else {
        console.error('Error loading orders:', error);
        toast.error(t('manufacturing.ordersPage.loadError'));
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOrders();
  }, []);

  return {
    orders,
    loading,
    loadOrders
  };
}

