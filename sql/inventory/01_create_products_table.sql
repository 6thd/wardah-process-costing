-- Create products table for inventory management
-- This is a simplified version that works standalone

-- First, check if we need organizations table
DO $$ 
BEGIN
    -- Create organizations table if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'organizations') THEN
        CREATE TABLE organizations (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name VARCHAR(255) NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        
        -- Insert default organization
        INSERT INTO organizations (id, name) 
        VALUES ('00000000-0000-0000-0000-000000000001', 'Default Organization')
        ON CONFLICT (id) DO NOTHING;
    END IF;
END $$;

-- Create products table
CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID DEFAULT '00000000-0000-0000-0000-000000000001',
    code VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    name_ar VARCHAR(255),
    description TEXT,
    unit VARCHAR(50) DEFAULT 'قطعة',
    category_id UUID,
    cost_price DECIMAL(12,2) DEFAULT 0,
    selling_price DECIMAL(12,2) DEFAULT 0,
    price DECIMAL(12,2) DEFAULT 0, -- For compatibility
    stock_quantity DECIMAL(12,2) DEFAULT 0,
    minimum_stock DECIMAL(12,2) DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT products_code_unique UNIQUE(org_id, code)
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_products_code ON products(code);
CREATE INDEX IF NOT EXISTS idx_products_org_id ON products(org_id);
CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id);

-- Enable RLS
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
DO $$ 
BEGIN
    -- Drop existing policies if they exist
    DROP POLICY IF EXISTS "Enable read access for all users" ON products;
    DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON products;
    DROP POLICY IF EXISTS "Enable update for authenticated users only" ON products;
    DROP POLICY IF EXISTS "Enable delete for authenticated users only" ON products;
    
    -- Create new policies
    CREATE POLICY "Enable read access for all users" ON products
        FOR SELECT USING (true);
    
    CREATE POLICY "Enable insert for authenticated users only" ON products
        FOR INSERT WITH CHECK (true);
    
    CREATE POLICY "Enable update for authenticated users only" ON products
        FOR UPDATE USING (true);
    
    CREATE POLICY "Enable delete for authenticated users only" ON products
        FOR DELETE USING (true);
END $$;

-- Create categories table if needed
CREATE TABLE IF NOT EXISTS categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID DEFAULT '00000000-0000-0000-0000-000000000001',
    tenant_id UUID DEFAULT '00000000-0000-0000-0000-000000000001',
    name VARCHAR(100) NOT NULL,
    name_ar VARCHAR(100),
    description TEXT,
    parent_id UUID REFERENCES categories(id),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS for categories
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for categories
DO $$ 
BEGIN
    DROP POLICY IF EXISTS "Enable read access for all users" ON categories;
    DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON categories;
    
    CREATE POLICY "Enable read access for all users" ON categories
        FOR SELECT USING (true);
    
    CREATE POLICY "Enable insert for authenticated users only" ON categories
        FOR INSERT WITH CHECK (true);
END $$;

-- Insert sample categories
INSERT INTO categories (name, name_ar) VALUES
    ('Raw Materials', 'مواد خام'),
    ('Finished Goods', 'منتجات تامة'),
    ('Semi-Finished', 'منتجات نصف مصنعة'),
    ('Packaging', 'مواد تعبئة')
ON CONFLICT DO NOTHING;

-- Success message
DO $$ 
BEGIN
    RAISE NOTICE 'Products table created successfully!';
END $$;
