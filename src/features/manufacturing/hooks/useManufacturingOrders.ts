import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { manufacturingService } from '@/services/supabase-service';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { ManufacturingOrder } from '@/lib/supabase';

/**
 * نفس مفتاح hooks/use-manufacturing.ts — كاش واحد مشترك عبر التطبيق:
 * أي invalidation من useCreateManufacturingOrder/useUpdateOrderStatus
 * يحدّث هذه الشاشات تلقائياً، والعكس صحيح
 */
export const MANUFACTURING_ORDERS_QUERY_KEY = ['manufacturing-orders'] as const;

/**
 * بند 11: موحَّد على React Query داخلياً — الواجهة الخارجية
 * { orders, loading, loadOrders } كما كانت تماماً، لا كسر لأي مستهلك.
 * المكاسب: كاش مشترك + إلغاء تكرار الطلبات + refetch تلقائي
 */
export function useManufacturingOrders() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<ManufacturingOrder[]>({
    queryKey: MANUFACTURING_ORDERS_QUERY_KEY,
    queryFn: async () => {
      try {
        const data = await manufacturingService.getAll();
        return (data || []) as unknown as ManufacturingOrder[];
      } catch (error: unknown) {
        const err = error as { code?: string; message?: string };
        if (err.code === 'PGRST205' || err.message?.includes('Could not find the table')) {
          console.warn('manufacturing_orders table not found, using empty array');
          return [];
        }
        console.error('Error loading orders:', error);
        toast.error(t('manufacturing.ordersPage.loadError'));
        return [];
      }
    },
    staleTime: 30_000,
  });

  // نفس التوقيع القديم: تُستدعى بعد الإنشاء/تغيير الحالة لإعادة التحميل
  const loadOrders = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: MANUFACTURING_ORDERS_QUERY_KEY });
  }, [queryClient]);

  return {
    orders: data ?? [],
    loading: isLoading,
    loadOrders
  };
}
