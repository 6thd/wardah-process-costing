# Fix for Recursive Triggers in Chart of Accounts

## Problem

The application was experiencing "stack depth limit exceeded" errors when querying the chart of accounts hierarchy. This was caused by recursive triggers that were creating infinite loops during account updates.

## Solution

We've implemented several proven patterns to prevent infinite recursion in PostgreSQL triggers:

1. **Added a flag column** (`in_process`) to prevent re-entry
2. **Separated INSERT and UPDATE triggers** to handle WHEN conditions properly
3. **Implemented depth limits** to prevent too-deep hierarchies
4. **Added proper exception handling** to clear flags even on errors
5. **Used trigger disabling during bulk operations** to prevent recursion

## Implementation Steps

### 1. Apply the Fix Script

1. Run the `FIX_RECURSIVE_TRIGGERS.sql` script in your Supabase SQL Editor
2. This will:
   - Add an `in_process` flag column to prevent re-entry
   - Replace the problematic trigger with separated INSERT and UPDATE triggers
   - Add depth checking to prevent too-deep hierarchies
   - Temporarily disable triggers during bulk operations
   - Backfill existing accounts with proper path values

### 2. Verify the Fix

1. Check that the triggers are working correctly:
   ```sql
   SELECT tgname, tgtype, tgdefinition 
   FROM pg_trigger t
   JOIN pg_class c ON t.tgrelid = c.oid
   WHERE c.relname = 'gl_accounts';
   ```

2. Test inserting or updating a chart of accounts record:
   ```sql
   INSERT INTO gl_accounts (id, code, name, org_id, category, subtype, normal_balance, allow_posting, is_active, currency)
   VALUES ('11111111-1111-1111-1111-111111111111', '100000', 'Assets', '00000000-0000-0000-0000-000000000001', 'ASSET', 'OTHER', 'DEBIT', false, true, 'SAR');
   ```

### 3. Restart Your Application

1. Restart your development server
2. The chart of accounts should now display without stack depth errors

## How the Fix Works

### 1. Re-entry Prevention

The `in_process` flag prevents the trigger from firing multiple times for the same row:

```sql
-- Guard against re-entry to prevent infinite recursion
IF NEW.in_process IS TRUE THEN
  RETURN NEW;
END IF;
```

### 2. Separate Triggers for INSERT and UPDATE

Since INSERT operations don't have OLD values, we separate the triggers:

```sql
-- For INSERT operations
CREATE TRIGGER trg_set_gl_account_path_insert
BEFORE INSERT ON gl_accounts
FOR EACH ROW
EXECUTE FUNCTION set_gl_account_path();

-- For UPDATE operations (only when parent_id or code changes)
CREATE TRIGGER trg_set_gl_account_path_update
BEFORE UPDATE OF parent_id, code ON gl_accounts
FOR EACH ROW
WHEN (NEW.parent_id IS DISTINCT FROM OLD.parent_id OR NEW.code IS DISTINCT FROM OLD.code)
EXECUTE FUNCTION set_gl_account_path();
```

### 3. Depth Limiting

The depth check prevents hierarchies from becoming too deep using the path-based approach:

```sql
-- Calculate depth based on path (number of segments)
SELECT nlevel(parent_path) INTO current_depth;

IF current_depth > 50 THEN
  RAISE EXCEPTION 'Account hierarchy too deep: % levels. Maximum allowed is 50.', current_depth;
END IF;
```

### 4. Bulk Operation Safety

During bulk operations, triggers are temporarily disabled:

```sql
-- Temporarily disable triggers to prevent recursion during bulk update
ALTER TABLE gl_accounts DISABLE TRIGGER trg_set_gl_account_path_insert;
ALTER TABLE gl_accounts DISABLE TRIGGER trg_set_gl_account_path_update;

-- ... bulk operations ...

-- Re-enable triggers
ALTER TABLE gl_accounts ENABLE TRIGGER trg_set_gl_account_path_insert;
ALTER TABLE gl_accounts ENABLE TRIGGER trg_set_gl_account_path_update;
```

## Benefits

1. **Eliminates recursion**: No more stack depth limit exceeded errors
2. **Better performance**: Triggers only run when necessary
3. **Safer updates**: Depth limits prevent problematic hierarchies
4. **Maintainable**: Clear guard conditions make debugging easier
5. **Bulk operation safe**: Triggers can be disabled during bulk updates

## Prevention

To prevent similar issues in the future:

1. Always separate INSERT and UPDATE triggers when using WHEN conditions
2. Implement re-entry prevention with flag columns
3. Add depth limits to hierarchical data operations
4. Use trigger disabling during bulk operations
5. Regularly monitor trigger performance with `EXPLAIN ANALYZE`