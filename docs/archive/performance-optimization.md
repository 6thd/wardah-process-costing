# تحسين الأداء ونظام Realtime - Wardah ERP

## التحديات الحالية:
- نظام Realtime أساسي جداً
- عدم وجود تحسينات للأداء
- عدم وجود Caching متقدم
- عدم تجميع الاستعلامات المشتركة

## الحلول المقترحة:

### 1. نظام Realtime متطور

#### أ) إدارة ذكية للاشتراكات:
```typescript
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
    // تطبيق فلتر إذا كان متاحاً
    if (config.filter && !config.filter(payload)) return;

    // تحويل البيانات إذا كان متاحاً
    const transformedPayload = config.transform ? config.transform(payload) : payload;

    const updateQueries = () => {
      config.queryKeys.forEach(queryKey => {
        // تحديث ذكي للـ Cache
        if (payload.eventType === 'DELETE') {
          queryClient.removeQueries({ queryKey });
        } else {
          queryClient.invalidateQueries({ queryKey });
          
          // تحديث مباشر للبيانات في الـ Cache إذا كان ممكناً
          const currentData = queryClient.getQueryData(queryKey);
          if (currentData && Array.isArray(currentData)) {
            const updatedData = updateCacheData(currentData, transformedPayload, payload.eventType);
            queryClient.setQueryData(queryKey, updatedData);
          }
        }
      });
    };

    // Debounce للتحديثات المتتالية
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
    configs.forEach(config => {
      if (channelsRef.current.has(config.tableName)) return;

      const channel = supabase
        .channel(`wardah-${config.tableName}-optimized`)
        .on('postgres_changes', 
          { 
            event: '*', 
            schema: 'public', 
            table: config.tableName,
            // إضافة فلتر على مستوى القاعدة لتحسين الأداء
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

    // تنظيف الاشتراكات عند انتهاء المكون
    return () => {
      channelsRef.current.forEach(channel => {
        supabase.removeChannel(channel);
      });
      channelsRef.current.clear();
      
      // تنظيف المؤقتات
      debounceTimers.current.forEach(timer => clearTimeout(timer));
      debounceTimers.current.clear();
    };
  }, [configs, handleUpdate]);

  return {
    activeChannels: channelsRef.current.size,
    disconnect: () => {
      channelsRef.current.forEach(channel => {
        supabase.removeChannel(channel);
      });
      channelsRef.current.clear();
    }
  };
};

// دالة مساعدة لتحديث بيانات الـ Cache
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
```

#### ب) مؤشر اتصال متقدم:
```typescript
// src/components/ConnectionStatus.tsx
import React, { useState, useEffect } from 'react';
import { Wifi, WifiOff, AlertCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase';

export const ConnectionStatus: React.FC = () => {
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('connecting');
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [reconnectAttempts, setReconnectAttempts] = useState(0);

  useEffect(() => {
    let reconnectTimer: NodeJS.Timeout;
    
    // مراقبة حالة الاتصال
    const checkConnection = async () => {
      try {
        const { data, error } = await supabase.from('organizations').select('id').limit(1);
        
        if (error) {
          setStatus('error');
          console.error('Connection error:', error);
        } else {
          setStatus('connected');
          setLastUpdate(new Date());
          setReconnectAttempts(0);
        }
      } catch (err) {
        setStatus('disconnected');
        setReconnectAttempts(prev => prev + 1);
        
        // محاولة إعادة الاتصال
        if (reconnectAttempts < 5) {
          reconnectTimer = setTimeout(checkConnection, 5000 * Math.pow(2, reconnectAttempts));
        }
      }
    };

    // فحص أولي
    checkConnection();
    
    // فحص دوري كل 30 ثانية
    const interval = setInterval(checkConnection, 30000);

    return () => {
      clearInterval(interval);
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [reconnectAttempts]);

  const getStatusConfig = () => {
    switch (status) {
      case 'connected':
        return {
          icon: <Wifi className="w-4 h-4" />,
          text: 'متصل',
          variant: 'default' as const,
          className: 'bg-green-500 text-white'
        };
      case 'connecting':
        return {
          icon: <Wifi className="w-4 h-4 animate-pulse" />,
          text: 'جارٍ الاتصال...',
          variant: 'secondary' as const,
          className: 'bg-yellow-500 text-white'
        };
      case 'disconnected':
        return {
          icon: <WifiOff className="w-4 h-4" />,
          text: `منقطع (${reconnectAttempts}/5)`,
          variant: 'destructive' as const,
          className: 'bg-red-500 text-white'
        };
      case 'error':
        return {
          icon: <AlertCircle className="w-4 h-4" />,
          text: 'خطأ في الاتصال',
          variant: 'destructive' as const,
          className: 'bg-red-600 text-white'
        };
    }
  };

  const config = getStatusConfig();

  return (
    <div className="flex items-center gap-2">
      <Badge variant={config.variant} className={`${config.className} flex items-center gap-2`}>
        {config.icon}
        {config.text}
      </Badge>
      
      {status === 'connected' && (
        <span className="text-xs text-muted-foreground">
          آخر تحديث: {lastUpdate.toLocaleTimeString('ar-SA')}
        </span>
      )}
    </div>
  );
};
```

### 2. تحسين الأداء مع React Query

#### أ) Prefetching ذكي:
```typescript
// src/hooks/useSmartPrefetch.ts
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

export const useSmartPrefetch = () => {
  const queryClient = useQueryClient();

  useEffect(() => {
    // Prefetch البيانات المهمة عند بدء التطبيق
    const prefetchCriticalData = async () => {
      // بيانات المنتجات الأساسية
      queryClient.prefetchQuery({
        queryKey: ['products', 'active'],
        queryFn: () => fetchActiveProducts(),
        staleTime: 10 * 60 * 1000, // 10 دقائق
      });

      // مراكز العمل
      queryClient.prefetchQuery({
        queryKey: ['work-centers'],
        queryFn: () => fetchWorkCenters(),
        staleTime: 30 * 60 * 1000, // 30 دقيقة
      });

      // أوامر التصنيع الحالية
      queryClient.prefetchQuery({
        queryKey: ['manufacturing-orders', 'active'],
        queryFn: () => fetchActiveManufacturingOrders(),
        staleTime: 2 * 60 * 1000, // دقيقتان
      });
    };

    prefetchCriticalData();
  }, [queryClient]);

  // Prefetch عند التنقل
  const prefetchOnHover = (queryKey: string[], queryFn: () => Promise<any>) => {
    queryClient.prefetchQuery({
      queryKey,
      queryFn,
      staleTime: 5 * 60 * 1000,
    });
  };

  return { prefetchOnHover };
};
```

#### ب) Optimistic Updates:
```typescript
// src/hooks/useOptimisticUpdates.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export const useOptimisticManufacturingOrderUpdate = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: any }) => {
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
      // إلغاء أي استعلامات قيد التحديث
      await queryClient.cancelQueries({ queryKey: ['manufacturing-orders'] });

      // حفظ البيانات السابقة للـ Rollback
      const previousOrders = queryClient.getQueryData(['manufacturing-orders']);

      // تحديث مؤقت للبيانات
      queryClient.setQueryData(['manufacturing-orders'], (old: any[]) => {
        if (!old) return [];
        return old.map(order => 
          order.id === id ? { ...order, ...updates } : order
        );
      });

      // إرجاع البيانات للـ Rollback
      return { previousOrders };
    },
    
    // في حالة الفشل، ارجع للبيانات السابقة
    onError: (err, variables, context) => {
      if (context?.previousOrders) {
        queryClient.setQueryData(['manufacturing-orders'], context.previousOrders);
      }
    },
    
    // تحديث نهائي في كل الحالات
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['manufacturing-orders'] });
    },
  });
};
```

### 3. نظام Caching متقدم

#### أ) Cache Persistence:
```typescript
// src/lib/persistentCache.ts
import { QueryClient } from '@tanstack/react-query';
import { persistQueryClient } from '@tanstack/react-query-persist-client';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';

// إعداد الـ Cache المستمر
const localStoragePersister = createSyncStoragePersister({
  storage: window.localStorage,
  key: 'wardah-query-cache',
  throttleTime: 1000,
});

export const createPersistedQueryClient = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000, // 5 دقائق
        cacheTime: 10 * 60 * 1000, // 10 دقائق
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        retry: (failureCount, error: any) => {
          // لا تعيد المحاولة للأخطاء 4xx
          if (error?.status >= 400 && error?.status < 500) return false;
          return failureCount < 3;
        },
      },
      mutations: {
        retry: 1,
      },
    },
  });

  // تمكين الـ Persistence
  persistQueryClient({
    queryClient,
    persister: localStoragePersister,
    maxAge: 1000 * 60 * 60 * 24, // يوم واحد
    buster: '1.0.0', // إصدار الـ Cache
  });

  return queryClient;
};
```

### 4. مراقبة الأداء

#### أ) Performance Monitor:
```typescript
// src/components/PerformanceMonitor.tsx
import React, { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

interface PerformanceMetrics {
  cacheHitRate: number;
  averageResponseTime: number;
  activeQueries: number;
  failedQueries: number;
  memoryUsage: number;
}

export const PerformanceMonitor: React.FC = () => {
  const queryClient = useQueryClient();
  const [metrics, setMetrics] = useState<PerformanceMetrics>({
    cacheHitRate: 0,
    averageResponseTime: 0,
    activeQueries: 0,
    failedQueries: 0,
    memoryUsage: 0,
  });

  useEffect(() => {
    const interval = setInterval(() => {
      const cache = queryClient.getQueryCache();
      const queries = cache.getAll();
      
      const activeQueries = queries.filter(q => q.isFetching()).length;
      const failedQueries = queries.filter(q => q.state.status === 'error').length;
      const cacheHits = queries.filter(q => q.state.dataUpdatedAt > 0).length;
      
      setMetrics({
        cacheHitRate: queries.length > 0 ? (cacheHits / queries.length) * 100 : 0,
        averageResponseTime: 0, // يحتاج حساب متقدم
        activeQueries,
        failedQueries,
        memoryUsage: performance.memory?.usedJSHeapSize / 1024 / 1024 || 0,
      });
    }, 5000);

    return () => clearInterval(interval);
  }, [queryClient]);

  // إظهار المؤشرات فقط في Development Mode
  if (process.env.NODE_ENV !== 'development') return null;

  return (
    <div className="fixed bottom-4 right-4 bg-white border rounded-lg p-3 shadow-lg text-xs">
      <div className="font-bold mb-2">مؤشرات الأداء</div>
      <div>معدل الكاش: {metrics.cacheHitRate.toFixed(1)}%</div>
      <div>استعلامات نشطة: {metrics.activeQueries}</div>
      <div>استعلامات فاشلة: {metrics.failedQueries}</div>
      <div>الذاكرة: {metrics.memoryUsage.toFixed(1)} MB</div>
    </div>
  );
};
```

## النتائج المتوقعة:
✅ تحسين أداء التطبيق بنسبة 60-80%
✅ نظام Realtime ذكي مع Debouncing
✅ مؤشر اتصال متقدم مع إعادة الاتصال التلقائي
✅ Optimistic Updates للتفاعل السريع
✅ Cache Persistence للبيانات الثابتة
✅ مراقبة الأداء في الوقت الفعلي