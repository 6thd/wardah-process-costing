-- إنشاء مؤسسة وردة البيان فقط
INSERT INTO organizations (id, name, code, is_active, settings)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'وردة البيان للصناعات البلاستيكية',
  'WARDAH',
  true,
  '{"currency": "SAR", "timezone": "Asia/Riyadh", "fiscal_year_start": "01-01"}'::jsonb
)
ON CONFLICT (id) DO UPDATE
SET 
  name = EXCLUDED.name,
  code = EXCLUDED.code,
  is_active = EXCLUDED.is_active,
  settings = EXCLUDED.settings,
  updated_at = now();

-- التحقق
SELECT * FROM organizations WHERE id = '00000000-0000-0000-0000-000000000001';
