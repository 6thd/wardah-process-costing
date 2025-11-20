-- Script to refresh Supabase schema cache
-- Run this in your Supabase SQL Editor if functions are not being found

-- This command tells Supabase to refresh its schema cache
-- Note: This is typically done automatically, but can be forced if needed
SELECT pg_notify('pgrst', 'reload schema');

-- Alternative approach: Restart the PostgREST service
-- This would normally be done through the Supabase dashboard