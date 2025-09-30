# Performance Optimization Guide - Wardah ERP

## Overview
This guide explains how to use the new performance optimization features implemented in the Wardah ERP system. These features include smart realtime subscriptions, connection status monitoring, prefetching, optimistic updates, and performance monitoring.

## New Features

### 1. Smart Realtime Subscriptions (`useSmartRealtime`)

The `useSmartRealtime` hook provides an enhanced realtime subscription system with the following features:

- **Smart Cache Updates**: Automatically updates React Query cache based on realtime events
- **Debouncing**: Prevents excessive updates when multiple events occur in quick succession
- **Filtering**: Allows filtering of events at the database level
- **Transformations**: Enables data transformation before updating the cache

#### Usage Example:
```typescript
import { useSmartRealtime } from '@/hooks/useSmartRealtime';

const MyComponent = () => {
  useSmartRealtime([
    {
      tableName: 'manufacturing_orders',
      queryKeys: [['manufacturing-orders']],
      debounceMs: 1000, // Debounce for 1 second
      filter: (payload) => payload.new.status === 'in_progress',
      transform: (payload) => ({
        ...payload.new,
        display_name: `${payload.new.order_number} - ${payload.new.product_name}`
      })
    }
  ]);

  return <div>My Component</div>;
};
```

### 2. Connection Status Monitor (`ConnectionStatus`)

The `ConnectionStatus` component displays the current connection status with automatic reconnection attempts.

#### Usage Example:
```typescript
import { ConnectionStatus } from '@/components/ConnectionStatus';

const AppBar = () => {
  return (
    <header>
      <h1>Wardah ERP</h1>
      <ConnectionStatus />
    </header>
  );
};
```

### 3. Smart Prefetching (`useSmartPrefetch`)

The `useSmartPrefetch` hook provides intelligent data prefetching to improve user experience.

#### Usage Example:
```typescript
import { useSmartPrefetch } from '@/hooks/useSmartPrefetch';

const App = () => {
  const { prefetchOnHover } = useSmartPrefetch();
  
  return (
    <nav>
      <button 
        onMouseEnter={() => prefetchOnHover(['reports'], fetchReports)}
      >
        Reports
      </button>
    </nav>
  );
};
```

### 4. Optimistic Updates (`useOptimisticManufacturingOrderUpdate`)

The `useOptimisticManufacturingOrderUpdate` hook provides optimistic updates for manufacturing orders, making the UI feel more responsive.

#### Usage Example:
```typescript
import { useOptimisticManufacturingOrderUpdate } from '@/hooks/useOptimisticUpdates';

const ManufacturingOrderForm = ({ orderId }) => {
  const updateMutation = useOptimisticManufacturingOrderUpdate();
  
  const handleUpdate = (updates) => {
    updateMutation.mutate({ id: orderId, updates });
  };
  
  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      handleUpdate({ status: 'completed' });
    }}>
      {/* form fields */}
    </form>
  );
};
```

### 5. Performance Monitor (`PerformanceMonitor`)

The `PerformanceMonitor` component displays real-time performance metrics during development.

#### Usage Example:
```typescript
import { PerformanceMonitor } from '@/components/PerformanceMonitor';

const App = () => {
  return (
    <>
      {/* Your app components */}
      <PerformanceMonitor />
    </>
  );
};
```

## Configuration

### Query Client Optimization

The main query client has been optimized with the following settings:

- `staleTime`: 5 minutes - Reduces unnecessary refetching
- `gcTime`: 10 minutes - Controls how long inactive queries are cached
- `refetchOnWindowFocus`: false - Prevents unnecessary refetching when window regains focus
- `refetchOnReconnect`: true - Ensures data is fresh after reconnection
- `retry`: Smart retry logic - Doesn't retry on client errors (4xx)

## Best Practices

1. **Use Smart Realtime**: Replace basic `useRealtimeSubscription` with `useSmartRealtime` for better performance
2. **Implement Prefetching**: Use `useSmartPrefetch` to load data before users need it
3. **Enable Optimistic Updates**: Use optimistic updates for better user experience
4. **Monitor Performance**: Use `PerformanceMonitor` during development to identify bottlenecks
5. **Check Connection Status**: Display `ConnectionStatus` to keep users informed

## Migration from Old System

### Before:
```typescript
useRealtimeSubscription('manufacturing_orders', ['manufacturing-orders']);
```

### After:
```typescript
useSmartRealtime([
  {
    tableName: 'manufacturing_orders',
    queryKeys: [['manufacturing-orders']],
    debounceMs: 500
  }
]);
```

## Troubleshooting

### Common Issues

1. **Realtime subscriptions not working**: Ensure the Supabase client is properly initialized
2. **Prefetching errors**: Check that the functions being prefetched handle errors properly
3. **Optimistic updates rollback**: Make sure the error handling in `onError` properly restores previous state

### Debugging Tips

1. Check browser console for error messages
2. Use React Query Devtools to inspect query states
3. Enable detailed logging by setting `localStorage.debug = 'wardah:*'`

## Future Enhancements

1. **Advanced Caching**: Implement full persistence with `@tanstack/react-query-persist-client`
2. **Request Batching**: Group multiple requests into single HTTP calls
3. **Adaptive Prefetching**: Use machine learning to predict user behavior
4. **Detailed Performance Metrics**: Track actual response times and network usage