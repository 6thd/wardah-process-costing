// src/hooks/useSmartPrefetch.ts
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';

// Functions to fetch critical data
const fetchActiveProducts = async () => {
  if (!supabase) return [];
  
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('is_active', true);
  
  if (error) throw error;
  return data;
};

const fetchWorkCenters = async () => {
  if (!supabase) return [];
  
  const { data, error } = await supabase
    .from('work_centers')
    .select('*');
  
  if (error) throw error;
  return data;
};

const fetchActiveManufacturingOrders = async () => {
  if (!supabase) return [];
  
  const { data, error } = await supabase
    .from('manufacturing_orders')
    .select('*')
    .in('status', ['pending', 'in_progress']);
  
  if (error) throw error;
  return data;
};

export const useSmartPrefetch = () => {
  const queryClient = useQueryClient();

  useEffect(() => {
    // Prefetch critical data when app starts
    const prefetchCriticalData = async () => {
      try {
        // Active products
        queryClient.prefetchQuery({
          queryKey: ['products', 'active'],
          queryFn: () => fetchActiveProducts(),
          staleTime: 10 * 60 * 1000, // 10 minutes
        });

        // Work centers
        queryClient.prefetchQuery({
          queryKey: ['work-centers'],
          queryFn: () => fetchWorkCenters(),
          staleTime: 30 * 60 * 1000, // 30 minutes
        });

        // Active manufacturing orders
        queryClient.prefetchQuery({
          queryKey: ['manufacturing-orders', 'active'],
          queryFn: () => fetchActiveManufacturingOrders(),
          staleTime: 2 * 60 * 1000, // 2 minutes
        });
      } catch (error) {
        console.error('Error prefetching critical data:', error);
      }
    };

    prefetchCriticalData();
  }, [queryClient]);

  // Prefetch on hover
  const prefetchOnHover = (queryKey: string[], queryFn: () => Promise<any>) => {
    queryClient.prefetchQuery({
      queryKey,
      queryFn,
      staleTime: 5 * 60 * 1000, // 5 minutes
    });
  };

  return { prefetchOnHover };
};