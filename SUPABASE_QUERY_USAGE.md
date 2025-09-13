# Supabase Query Usage Guide

## The Problem That Was Fixed

Previously, the `withTenant` function was trying to call `.eq()` directly on `client.from(table)`, which returns a `PostgrestQueryBuilder`. However, Supabase requires that you initialize a query operation (like `.select()`, `.insert()`, `.update()`, or `.delete()`) **before** you can use filter methods like `.eq()`.

```typescript
// ❌ WRONG - This causes the error
client.from('items').eq('tenant_id', tenantId)  // Error: Property 'eq' does not exist

// ✅ CORRECT - Initialize query first, then filter
client.from('items').select('*').eq('tenant_id', tenantId)
```

## How to Use the Fixed `withTenant` Function

The `withTenant` function now returns an object with properly initialized query methods:

### 1. Select Queries

```typescript
// Get all items for current tenant
const itemsQuery = await withTenant('items')
const { data, error } = await itemsQuery.select('*')

// Get specific columns
const { data, error } = await itemsQuery.select('id, name, code')

// With additional filters
const { data, error } = await itemsQuery
  .select('*')
  .eq('category_id', 'some-category-id')
  .order('name')
```

### 2. Insert Operations

```typescript
// Insert new item (tenant_id automatically added if multi-tenant enabled)
const itemsQuery = await withTenant('items')
const { data, error } = await itemsQuery.insert({
  name: 'New Item',
  code: 'ITEM001',
  cost_price: 100
})
```

### 3. Update Operations

```typescript
// Update items for current tenant
const itemsQuery = await withTenant('items')
const { data, error } = await itemsQuery
  .update({ cost_price: 150 })
  .eq('id', 'item-id')
```

### 4. Delete Operations

```typescript
// Delete items for current tenant
const itemsQuery = await withTenant('items')
const { data, error } = await itemsQuery
  .delete()
  .eq('id', 'item-id')
```

### 5. Upsert Operations

```typescript
// Upsert (insert or update) with tenant context
const itemsQuery = await withTenant('items')
const { data, error } = await itemsQuery.upsert({
  id: 'existing-or-new-id',
  name: 'Updated Item',
  code: 'ITEM001'
})
```

### 6. Advanced Usage - Raw Client Access

For complex queries, you can access the raw client:

```typescript
const itemsQuery = await withTenant('items')
const client = itemsQuery.from()
const tenantId = itemsQuery.getTenantId()
const tableName = itemsQuery.getTableName()

// Now you can build complex queries manually
const { data, error } = await client
  .select(`
    *,
    category:categories(name),
    movements:stock_movements(*)
  `)
  .eq('tenant_id', tenantId)
  .order('created_at', { ascending: false })
  .limit(100)
```

## Migration Guide

If you were using the old `withTenant` function, here's how to migrate:

### Before (Old Way - Caused Errors)
```typescript
// This would cause the 'eq' does not exist error
const query = await withTenant('items')
const { data, error } = await query.eq('status', 'active')
```

### After (New Way - Works Correctly)
```typescript
// Method 1: Use the select method
const itemsQuery = await withTenant('items')
const { data, error } = await itemsQuery
  .select('*')
  .eq('status', 'active')

// Method 2: Use raw client for complex queries
const itemsQuery = await withTenant('items')
const { data, error } = await itemsQuery.from()
  .select('*')
  .eq('tenant_id', itemsQuery.getTenantId())
  .eq('status', 'active')
```

## Real-World Examples

### Example 1: Items Service
```typescript
export const getActiveItems = async () => {
  const itemsQuery = await withTenant('items')
  const { data, error } = await itemsQuery
    .select(`
      *,
      category:categories(name, name_ar)
    `)
    .eq('is_active', true)
    .order('name')
  
  if (error) throw error
  return data
}
```

### Example 2: Manufacturing Orders
```typescript
export const getOrdersByStatus = async (status: string) => {
  const ordersQuery = await withTenant('manufacturing_orders')
  const { data, error } = await ordersQuery
    .select(`
      *,
      item:items(name, code),
      process_costs(*)
    `)
    .eq('status', status)
    .order('created_at', { ascending: false })
  
  if (error) throw error
  return data
}
```

### Example 3: Complex Filtering
```typescript
export const getLowStockItems = async () => {
  const itemsQuery = await withTenant('items')
  const { data, error } = await itemsQuery
    .select('*')
    .filter('stock_quantity', 'lte', 'minimum_stock')
    .eq('is_active', true)
    .order('stock_quantity')
  
  if (error) throw error
  return data
}
```

## Key Benefits of the Fix

1. **Type Safety**: Proper TypeScript support with correct method chaining
2. **Tenant Security**: Automatic tenant filtering when multi-tenant is enabled
3. **Flexibility**: Access to both convenience methods and raw client for complex queries
4. **Consistency**: Same pattern across all query types (select, insert, update, delete)
5. **Error Prevention**: No more "Property 'eq' does not exist" errors

## Important Notes

- Always await the `withTenant()` call first to get the query object
- The tenant_id is automatically added to insert/upsert operations when multi-tenant is enabled
- Update and delete operations are automatically filtered by tenant_id when multi-tenant is enabled
- Use the `.from()` method to access the raw Supabase client for complex queries
- Use `.getTenantId()` and `.getTableName()` helpers for manual query building