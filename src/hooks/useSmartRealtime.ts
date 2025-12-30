// src/hooks/useSmartRealtime.ts
import { useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

interface RealtimePayload {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  new?: Record<string, unknown> & { id?: string };
  old?: Record<string, unknown> & { id?: string };
}

interface RealtimeConfig {
  tableName: string;
  queryKeys: string[][];
  filter?: (payload: RealtimePayload) => boolean;
  transform?: (payload: RealtimePayload) => unknown;
  debounceMs?: number;
}

export const useSmartRealtime = (configs: RealtimeConfig[]) => {
  const queryClient = useQueryClient();
  const channelsRef = useRef<Map<string, unknown>>(new Map());
  const debounceTimers = useRef<Map<string, NodeJS.Timeout>>(new Map());

  const handleUpdate = useCallback((config: RealtimeConfig, payload: RealtimePayload) => {
    // Apply filter if available
    if (config.filter && !config.filter(payload)) return;

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
            const updatedData = updateCacheData(currentData, payload, payload.eventType);
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

    // Capture refs at effect start to use in cleanup
    const channels = channelsRef.current;
    const timers = debounceTimers.current;

    configs.forEach(config => {
      if (channels.has(config.tableName)) return;
      
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
            // eslint-disable-next-line no-console
            console.log(`✅ Realtime subscription active for ${config.tableName}`);
          }
        });

      channels.set(config.tableName, channel);
    });

    // Clean up subscriptions when component unmounts
    return () => {
      // Use captured refs from effect start
      const channelsSnapshot = Array.from(channels.values());
      const timersSnapshot = Array.from(timers.values());
      
      channelsSnapshot.forEach(channel => {
        if (supabase) {
          supabase.removeChannel(channel as ReturnType<typeof supabase.channel>);
        }
      });
      channels.clear();
      
      // Clean up timers
      timersSnapshot.forEach(timer => clearTimeout(timer));
      timers.clear();
    };
  }, [configs, handleUpdate]);

  return {
    activeChannels: channelsRef.current.size,
    disconnect: () => {
      channelsRef.current.forEach(channel => {
        if (supabase) {
          supabase.removeChannel(channel as ReturnType<typeof supabase.channel>);
        }
      });
      channelsRef.current.clear();
    }
  };
};

// Helper function to update cache data
const updateCacheData = (currentData: unknown[], payload: RealtimePayload, eventType: string) => {
  switch (eventType) {
    case 'INSERT':
      return [...currentData, payload.new];
    case 'UPDATE':
      return currentData.map(item => {
        const itemObj = item as { id?: string };
        const newObj = payload.new as { id?: string } | undefined;
        return itemObj.id === newObj?.id ? { ...itemObj, ...payload.new } : item;
      });
    case 'DELETE':
      return currentData.filter(item => {
        const itemObj = item as { id?: string };
        const oldObj = payload.old as { id?: string } | undefined;
        return itemObj.id !== oldObj?.id;
      });
    default:
      return currentData;
  }
};