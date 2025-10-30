-- فحص قيود role المسموحة
SELECT 
  conname,
  pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'user_organizations'::regclass
  AND contype = 'c';
