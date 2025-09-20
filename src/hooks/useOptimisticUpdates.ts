// src/hooks/useOptimisticUpdates.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export const useOptimisticManufacturingOrderUpdate = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: any }) => {
      if (!supabase) throw new Error('Supabase client not initialized');
      
      const { data, error } = await supabase
        .from('manufacturing_orders')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    
    // Optimistic Update
    onMutate: async ({ id, updates }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['manufacturing-orders'] });

      // Snapshot the previous value
      const previousOrders = queryClient.getQueryData(['manufacturing-orders']);

      // Optimistically update to the new value
      queryClient.setQueryData(['manufacturing-orders'], (old: any[]) => {
        if (!old) return [];
        return old.map(order => 
          order.id === id ? { ...order, ...updates } : order
        );
      });

      // Return a context object with the snapshotted value
      return { previousOrders };
    },
    
    // If the mutation fails, use the context returned above
    onError: (err, variables, context) => {
      if (context?.previousOrders) {
        queryClient.setQueryData(['manufacturing-orders'], context.previousOrders);
      }
    },
    
    // Always refetch after error or success
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['manufacturing-orders'] });
    },
  });
};