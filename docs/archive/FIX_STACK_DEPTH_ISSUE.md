# Fixing Stack Depth Limit Exceeded Error

## Problem

The error "stack depth limit exceeded" is preventing your application from querying the database properly. This is a PostgreSQL configuration issue in your Supabase project.

## Solution

There are two approaches to fix this:

### Approach 1: Simplify Your Queries (Recommended)

Instead of running complex queries that exceed the stack depth limit, break them down into simpler queries:

1. **Check if tables exist with a simple query:**
```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name = 'gl_accounts';
```

2. **Count records instead of selecting all:**
```sql
SELECT COUNT(*) FROM gl_accounts;
```

3. **Limit results with simple queries:**
```sql
SELECT id, code, name FROM gl_accounts LIMIT 10;
```

### Approach 2: Increase Stack Depth Limit (Advanced)

If you have administrative access to your Supabase project:

1. Go to your Supabase project dashboard
2. Navigate to Settings > Database
3. In the "Configuration" section, find "max_stack_depth"
4. Increase it from the default (2048kB) to a higher value like 4096kB
5. Restart your database

### Immediate Workaround

Since you're experiencing this issue, let's modify your application to work with simpler queries:

1. Update your `queryGLAccounts` function in `src/lib/supabase.ts` to use a simpler query approach
2. Add error handling for stack depth limit errors
3. Provide fallback data when queries fail

This will allow your debug screen to show at least some information even when the database queries are failing.