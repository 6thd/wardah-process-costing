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
      
      const activeQueries = queries.filter(q => q.state.fetchStatus === 'fetching').length;
      const failedQueries = queries.filter(q => q.state.status === 'error').length;
      const cacheHits = queries.filter(q => q.state.dataUpdatedAt > 0).length;
      
      setMetrics({
        cacheHitRate: queries.length > 0 ? (cacheHits / queries.length) * 100 : 0,
        averageResponseTime: 0, // Would need advanced tracking
        activeQueries,
        failedQueries,
        memoryUsage: (performance as any).memory?.usedJSHeapSize / 1024 / 1024 || 0,
      });
    }, 5000);

    return () => clearInterval(interval);
  }, [queryClient]);

  // Only show in development mode
  if (process.env.NODE_ENV !== 'development') return null;

  return (
    <div className="fixed bottom-4 right-4 bg-white border rounded-lg p-3 shadow-lg text-xs z-50">
      <div className="font-bold mb-2">مؤشرات الأداء</div>
      <div>معدل الكاش: {metrics.cacheHitRate.toFixed(1)}%</div>
      <div>استعلامات نشطة: {metrics.activeQueries}</div>
      <div>استعلامات فاشلة: {metrics.failedQueries}</div>
      <div>الذاكرة: {metrics.memoryUsage.toFixed(1)} MB</div>
    </div>
  );
};