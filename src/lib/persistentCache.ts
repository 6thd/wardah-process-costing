// src/lib/persistentCache.ts
import { QueryClient } from '@tanstack/react-query';

export const createOptimizedQueryClient = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000, // 5 minutes
        gcTime: 10 * 60 * 1000, // 10 minutes (replaces cacheTime in v5)
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        retry: (failureCount, error: any) => {
          // Don't retry on 4xx errors
          if (error?.status >= 400 && error?.status < 500) return false;
          return failureCount < 3;
        },
      },
      mutations: {
        retry: 1,
      },
    },
  });

  return queryClient;
};

// Simple localStorage cache implementation
export const localStorageCache = {
  set: (key: string, value: any) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.warn('Failed to set cache item', e);
    }
  },
  get: (key: string) => {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : undefined;
    } catch (e) {
      console.warn('Failed to get cache item', e);
      return undefined;
    }
  },
  remove: (key: string) => {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      console.warn('Failed to remove cache item', e);
    }
  }
};