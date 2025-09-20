// src/hooks/useSmartRealtime.ts
import { useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

interface RealtimeConfig {
  tableName: string;
  queryKeys: string[][];
  filter?: (payload: any) => boolean;
  transform?: (payload: any) => any;
  debounceMs?: number;
}

export const useSmartRealtime = (configs: RealtimeConfig[]) => {
  const queryClient = useQueryClient();
  const channelsRef = useRef<Map<string, any>>(new Map());
  const debounceTimers = useRef<Map<string, NodeJS.Timeout>>(new Map());

  const handleUpdate = useCallback((config: RealtimeConfig, payload: any) => {
    // Apply filter if available
    if (config.filter && !config.filter(payload)) return;

    // Transform data if available
    const transformedPayload = config.transform ? config.transform(payload) : payload;

    const updateQueries = () => {
      config.queryKeys.forEach(queryKey => {
        // Smart cache update
        if (payload.eventType === 'DELETE') {
          queryClient.removeQueries({ queryKey });
        } else {
          queryClient.invalidateQueries({ queryKey });
          
          // Direct cache update if possible
          const currentData = queryClient.getQueryData(queryKey);
          if (currentData && Array.isArray(currentData)) {
            const updatedData = updateCacheData(currentData, transformedPayload, payload.eventType);
            queryClient.setQueryData(queryKey, updatedData);
          }
        }
      });
    };

    // Debounce for consecutive updates
    if (config.debounceMs) {
      const timerId = debounceTimers.current.get(config.tableName);
      if (timerId) clearTimeout(timerId);
      
      debounceTimers.current.set(
        config.tableName,
        setTimeout(updateQueries, config.debounceMs)
      );
    } else {
      updateQueries();
    }
  }, [queryClient]);

  useEffect(() => {
    if (!supabase) return;

    configs.forEach(config => {
      if (channelsRef.current.has(config.tableName)) return;
      
      // Add null check before using supabase
      if (!supabase) return;

      const channel = supabase
        .channel(`wardah-${config.tableName}-optimized`)
        .on('postgres_changes', 
          { 
            event: '*', 
            schema: 'public', 
            table: config.tableName,
            // Add base-level filter to improve performance
            filter: 'org_id=eq.00000000-0000-0000-0000-000000000001'
          },
          (payload) => handleUpdate(config, payload)
        )
        .subscribe(status => {
          if (status === 'SUBSCRIBED') {
            console.log(`✅ Realtime subscription active for ${config.tableName}`);
          }
        });

      channelsRef.current.set(config.tableName, channel);
    });

    // Clean up subscriptions when component unmounts
    return () => {
      channelsRef.current.forEach(channel => {
        if (supabase) {
          supabase.removeChannel(channel);
        }
      });
      channelsRef.current.clear();
      
      // Clean up timers
      debounceTimers.current.forEach(timer => clearTimeout(timer));
      debounceTimers.current.clear();
    };
  }, [configs, handleUpdate]);

  return {
    activeChannels: channelsRef.current.size,
    disconnect: () => {
      channelsRef.current.forEach(channel => {
        if (supabase) {
          supabase.removeChannel(channel);
        }
      });
      channelsRef.current.clear();
    }
  };
};

// Helper function to update cache data
const updateCacheData = (currentData: any[], payload: any, eventType: string) => {
  switch (eventType) {
    case 'INSERT':
      return [...currentData, payload.new];
    case 'UPDATE':
      return currentData.map(item => 
        item.id === payload.new.id ? { ...item, ...payload.new } : item
      );
    case 'DELETE':
      return currentData.filter(item => item.id !== payload.old.id);
    default:
      return currentData;
  }
};