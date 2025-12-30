// src/lib/persistentCache.ts
import { QueryClient } from '@tanstack/react-query';
import { safeLocalStorage } from './safe-storage';

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
    safeLocalStorage.setItem(key, JSON.stringify(value));
  },
  get: (key: string) => {
    const item = safeLocalStorage.getItem(key);
    if (!item) return undefined;
    try {
      return JSON.parse(item);
    } catch {
      return undefined;
    }
  },
  remove: (key: string) => {
    safeLocalStorage.removeItem(key);
  }
};