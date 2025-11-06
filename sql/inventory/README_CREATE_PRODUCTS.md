# إنشاء جدول Products في Supabase

## الخطوات السريعة:

### 1. افتح Supabase SQL Editor
رابط مباشر: https://supabase.com/dashboard/project/uutfztmqvajmsxnrqeiv/sql/new

### 2. نفذ الـ SQL Script
انسخ والصق السكريبت من ملف: `sql/inventory/01_create_products_table.sql`

أو نفذ هذا الكود البسيط:

```sql
-- Create products table (Simple Version)
CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    name_ar VARCHAR(255),
    description TEXT,
    unit VARCHAR(50) DEFAULT 'قطعة',
    category_id UUID,
    cost_price DECIMAL(12,2) DEFAULT 0,
    selling_price DECIMAL(12,2) DEFAULT 0,
    price DECIMAL(12,2) DEFAULT 0,
    stock_quantity DECIMAL(12,2) DEFAULT 0,
    minimum_stock DECIMAL(12,2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- Allow all operations (for testing)
CREATE POLICY "Allow all" ON products FOR ALL USING (true) WITH CHECK (true);

-- Create categories table
CREATE TABLE IF NOT EXISTS categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID DEFAULT '00000000-0000-0000-0000-000000000001',
    name VARCHAR(100) NOT NULL,
    name_ar VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS for categories
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON categories FOR ALL USING (true) WITH CHECK (true);

-- Add sample data
INSERT INTO categories (name, name_ar) VALUES
    ('Raw Materials', 'مواد خام'),
    ('Finished Goods', 'منتجات تامة')
ON CONFLICT DO NOTHING;
```

### 3. تحقق من النجاح
بعد التنفيذ، روح لـ Table Editor وتأكد من وجود:
- ✅ جدول `products`
- ✅ جدول `categories`

### 4. اختبر من المتصفح
- حدّث الصفحة (F5)
- روح لـ المخزون → الأصناف
- المفروض يفتح بدون أخطاء!

## ملاحظات:
- الجداول تُنشأ مع RLS مفعّل
- السياسات تسمح بكل العمليات للتجربة
- يمكن تشديد الصلاحيات لاحقاً
