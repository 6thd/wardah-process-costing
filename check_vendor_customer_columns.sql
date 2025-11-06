-- Check vendors and customers table structure
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'vendors' 
  AND table_schema = 'public'
ORDER BY ordinal_position;

SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'customers' 
  AND table_schema = 'public'
ORDER BY ordinal_position;
