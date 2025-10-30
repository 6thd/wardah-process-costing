-- =============================================
-- BOM System Database Setup
-- تحديث نظام قوائم المواد (Bill of Materials)
-- =============================================

-- 0. إنشاء الجداول الأساسية إذا لم تكن موجودة
-- =============================================

-- جدول bom_headers الأساسي
CREATE TABLE IF NOT EXISTS bom_headers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL,
    bom_number VARCHAR(100) NOT NULL,
    item_id UUID NOT NULL,
    quantity DECIMAL(18,6) DEFAULT 1.0,
    uom VARCHAR(50),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, bom_number)
);

-- جدول bom_lines الأساسي
CREATE TABLE IF NOT EXISTS bom_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL,
    bom_id UUID NOT NULL REFERENCES bom_headers(id) ON DELETE CASCADE,
    sequence INTEGER DEFAULT 1,
    item_id UUID NOT NULL,
    quantity DECIMAL(18,6) NOT NULL,
    uom VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1. تحديث جدول bom_headers
-- =============================================
ALTER TABLE bom_headers 
ADD COLUMN IF NOT EXISTS bom_version INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS effective_date DATE DEFAULT CURRENT_DATE,
ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(18,4) DEFAULT 0,
ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'APPROVED', 'OBSOLETE')),
ADD COLUMN IF NOT EXISTS notes TEXT;

-- إضافة تعليق على الجدول
COMMENT ON TABLE bom_headers IS 'رؤوس قوائم المواد - BOM Headers';
COMMENT ON COLUMN bom_headers.bom_version IS 'رقم إصدار القائمة';
COMMENT ON COLUMN bom_headers.is_active IS 'هل القائمة نشطة؟';
COMMENT ON COLUMN bom_headers.effective_date IS 'تاريخ السريان';
COMMENT ON COLUMN bom_headers.unit_cost IS 'تكلفة الوحدة المحسوبة';
COMMENT ON COLUMN bom_headers.status IS 'حالة القائمة: DRAFT, APPROVED, OBSOLETE';

-- 2. تحديث جدول bom_lines
-- =============================================
ALTER TABLE bom_lines
ADD COLUMN IF NOT EXISTS line_type VARCHAR(20) DEFAULT 'COMPONENT' CHECK (line_type IN ('COMPONENT', 'PHANTOM', 'REFERENCE')),
ADD COLUMN IF NOT EXISTS scrap_factor NUMERIC(5,2) DEFAULT 0 CHECK (scrap_factor >= 0 AND scrap_factor <= 100),
ADD COLUMN IF NOT EXISTS is_critical BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS yield_percentage NUMERIC(5,2) DEFAULT 100 CHECK (yield_percentage > 0 AND yield_percentage <= 100),
ADD COLUMN IF NOT EXISTS operation_sequence INTEGER,
ADD COLUMN IF NOT EXISTS notes TEXT,
ADD COLUMN IF NOT EXISTS effective_from DATE DEFAULT CURRENT_DATE,
ADD COLUMN IF NOT EXISTS effective_to DATE;

-- إضافة تعليقات
COMMENT ON TABLE bom_lines IS 'تفاصيل قوائم المواد - BOM Lines';
COMMENT ON COLUMN bom_lines.line_type IS 'نوع المكون: COMPONENT, PHANTOM, REFERENCE';
COMMENT ON COLUMN bom_lines.scrap_factor IS 'نسبة الهالك المتوقع (%)';
COMMENT ON COLUMN bom_lines.is_critical IS 'هل المادة حرجة؟';
COMMENT ON COLUMN bom_lines.yield_percentage IS 'نسبة المخرجات (%)';

-- 3. إنشاء جدول bom_versions
-- =============================================
CREATE TABLE IF NOT EXISTS bom_versions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bom_id UUID NOT NULL REFERENCES bom_headers(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    change_description TEXT,
    changed_by UUID REFERENCES auth.users(id),
    changed_at TIMESTAMP DEFAULT NOW(),
    org_id UUID NOT NULL,
    
    -- القيود
    UNIQUE(bom_id, version_number),
    CHECK (version_number > 0)
);

-- إضافة تعليقات
COMMENT ON TABLE bom_versions IS 'سجل إصدارات قوائم المواد';
COMMENT ON COLUMN bom_versions.version_number IS 'رقم الإصدار';
COMMENT ON COLUMN bom_versions.change_description IS 'وصف التغيير';

-- 4. إنشاء جدول bom_explosion_cache (للأداء)
-- =============================================
CREATE TABLE IF NOT EXISTS bom_explosion_cache (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bom_id UUID NOT NULL REFERENCES bom_headers(id) ON DELETE CASCADE,
    item_id UUID NOT NULL,
    parent_item_id UUID,
    level_number INTEGER NOT NULL DEFAULT 0,
    quantity_required NUMERIC(18,6) NOT NULL,
    total_quantity NUMERIC(18,6) NOT NULL,
    unit_cost NUMERIC(18,4),
    total_cost NUMERIC(18,4),
    org_id UUID NOT NULL,
    calculated_at TIMESTAMP DEFAULT NOW(),
    
    -- فهارس
    UNIQUE(bom_id, item_id, parent_item_id)
);

CREATE INDEX IF NOT EXISTS idx_bom_explosion_bom_id ON bom_explosion_cache(bom_id);
CREATE INDEX IF NOT EXISTS idx_bom_explosion_item_id ON bom_explosion_cache(item_id);
CREATE INDEX IF NOT EXISTS idx_bom_explosion_org_id ON bom_explosion_cache(org_id);

COMMENT ON TABLE bom_explosion_cache IS 'ذاكرة مؤقتة لتفجير قوائم المواد متعددة المستويات';

-- 5. إنشاء جدول bom_where_used
-- =============================================
CREATE TABLE IF NOT EXISTS bom_where_used (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    component_id UUID NOT NULL, -- المكون
    parent_bom_id UUID NOT NULL REFERENCES bom_headers(id) ON DELETE CASCADE,
    parent_item_id UUID NOT NULL, -- الصنف الأب
    quantity_per NUMERIC(18,6) NOT NULL,
    org_id UUID NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    -- فهارس
    UNIQUE(component_id, parent_bom_id)
);

CREATE INDEX IF NOT EXISTS idx_bom_where_used_component ON bom_where_used(component_id);
CREATE INDEX IF NOT EXISTS idx_bom_where_used_parent ON bom_where_used(parent_bom_id);

COMMENT ON TABLE bom_where_used IS 'استخدام المكون في قوائم مواد مختلفة (Where Used)';

-- 6. إنشاء Trigger لتحديث bom_versions
-- =============================================
CREATE OR REPLACE FUNCTION create_bom_version()
RETURNS TRIGGER AS $$
BEGIN
    -- عند تحديث bom_version، أنشئ سجل في جدول الإصدارات
    IF (TG_OP = 'UPDATE' AND OLD.bom_version IS DISTINCT FROM NEW.bom_version) THEN
        INSERT INTO bom_versions (bom_id, version_number, change_description, org_id)
        VALUES (NEW.id, NEW.bom_version, 'Version updated', NEW.org_id);
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bom_version_tracking ON bom_headers;
CREATE TRIGGER trg_bom_version_tracking
    AFTER UPDATE ON bom_headers
    FOR EACH ROW
    EXECUTE FUNCTION create_bom_version();

-- 7. إنشاء Trigger لتحديث Where-Used
-- =============================================
CREATE OR REPLACE FUNCTION update_bom_where_used()
RETURNS TRIGGER AS $$
BEGIN
    -- عند إضافة أو تحديث bom_lines، حدّث جدول where_used
    IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') THEN
        INSERT INTO bom_where_used (component_id, parent_bom_id, parent_item_id, quantity_per, org_id)
        SELECT 
            NEW.item_id,
            NEW.bom_id,
            bh.item_id,
            NEW.quantity,
            NEW.org_id
        FROM bom_headers bh
        WHERE bh.id = NEW.bom_id
        ON CONFLICT (component_id, parent_bom_id) 
        DO UPDATE SET 
            quantity_per = EXCLUDED.quantity_per,
            updated_at = NOW();
            
    ELSIF (TG_OP = 'DELETE') THEN
        DELETE FROM bom_where_used 
        WHERE component_id = OLD.item_id 
        AND parent_bom_id = OLD.bom_id;
    END IF;
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bom_where_used_update ON bom_lines;
CREATE TRIGGER trg_bom_where_used_update
    AFTER INSERT OR UPDATE OR DELETE ON bom_lines
    FOR EACH ROW
    EXECUTE FUNCTION update_bom_where_used();

-- 8. دالة BOM Explosion (فك قائمة المواد متعددة المستويات)
-- =============================================
CREATE OR REPLACE FUNCTION explode_bom(
    p_bom_id UUID,
    p_quantity NUMERIC DEFAULT 1,
    p_org_id UUID DEFAULT NULL
)
RETURNS TABLE (
    level_number INTEGER,
    item_id UUID,
    item_code VARCHAR,
    item_name VARCHAR,
    quantity_required NUMERIC,
    unit_of_measure VARCHAR,
    is_critical BOOLEAN,
    scrap_factor NUMERIC,
    line_type VARCHAR
) AS $$
DECLARE
    items_table_exists BOOLEAN;
    products_table_exists BOOLEAN;
BEGIN
    -- تحديد الجدول المستخدم (items أو products)
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'items'
    ) INTO items_table_exists;
    
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'products'
    ) INTO products_table_exists;

    -- استخدام items إذا كان موجوداً
    IF items_table_exists THEN
        RETURN QUERY
        WITH RECURSIVE bom_tree AS (
            SELECT 
                0 AS level,
                bh.item_id,
                bh.id AS bom_id,
                p_quantity AS qty_required,
                bl.is_critical,
                bl.scrap_factor,
                bl.line_type
            FROM bom_headers bh
            LEFT JOIN bom_lines bl ON bl.bom_id = bh.id
            WHERE bh.id = p_bom_id
            AND (p_org_id IS NULL OR bh.org_id = p_org_id)
            
            UNION ALL
            
            SELECT 
                bt.level + 1,
                bl.item_id,
                bh.id AS bom_id,
                bt.qty_required * bl.quantity * (1 + COALESCE(bl.scrap_factor, 0)/100),
                bl.is_critical,
                bl.scrap_factor,
                bl.line_type
            FROM bom_tree bt
            JOIN bom_lines bl ON bl.bom_id = bt.bom_id
            JOIN bom_headers bh ON bh.item_id = bl.item_id
            WHERE bt.level < 20
            AND bl.line_type != 'REFERENCE'
        )
        SELECT DISTINCT ON (bt.item_id)
            bt.level AS level_number,
            bt.item_id,
            COALESCE(i.code, i.item_code)::VARCHAR AS item_code,
            COALESCE(i.name, i.item_name)::VARCHAR AS item_name,
            bt.qty_required AS quantity_required,
            COALESCE(i.unit, i.unit_of_measure)::VARCHAR AS unit_of_measure,
            COALESCE(bt.is_critical, false) AS is_critical,
            COALESCE(bt.scrap_factor, 0) AS scrap_factor,
            COALESCE(bt.line_type, 'COMPONENT')::VARCHAR AS line_type
        FROM bom_tree bt
        LEFT JOIN items i ON i.id = bt.item_id
        ORDER BY bt.item_id, bt.level;
    
    -- استخدام products إذا كان موجوداً
    ELSIF products_table_exists THEN
        RETURN QUERY
        WITH RECURSIVE bom_tree AS (
            SELECT 
                0 AS level,
                bh.item_id,
                bh.id AS bom_id,
                p_quantity AS qty_required,
                bl.is_critical,
                bl.scrap_factor,
                bl.line_type
            FROM bom_headers bh
            LEFT JOIN bom_lines bl ON bl.bom_id = bh.id
            WHERE bh.id = p_bom_id
            AND (p_org_id IS NULL OR bh.org_id = p_org_id)
            
            UNION ALL
            
            SELECT 
                bt.level + 1,
                bl.item_id,
                bh.id AS bom_id,
                bt.qty_required * bl.quantity * (1 + COALESCE(bl.scrap_factor, 0)/100),
                bl.is_critical,
                bl.scrap_factor,
                bl.line_type
            FROM bom_tree bt
            JOIN bom_lines bl ON bl.bom_id = bt.bom_id
            JOIN bom_headers bh ON bh.item_id = bl.item_id
            WHERE bt.level < 20
            AND bl.line_type != 'REFERENCE'
        )
        SELECT DISTINCT ON (bt.item_id)
            bt.level AS level_number,
            bt.item_id,
            COALESCE(p.code, p.product_code)::VARCHAR AS item_code,
            COALESCE(p.name, p.product_name)::VARCHAR AS item_name,
            bt.qty_required AS quantity_required,
            COALESCE(p.unit, p.uom)::VARCHAR AS unit_of_measure,
            COALESCE(bt.is_critical, false) AS is_critical,
            COALESCE(bt.scrap_factor, 0) AS scrap_factor,
            COALESCE(bt.line_type, 'COMPONENT')::VARCHAR AS line_type
        FROM bom_tree bt
        LEFT JOIN products p ON p.id = bt.item_id
        ORDER BY bt.item_id, bt.level;
    ELSE
        RAISE EXCEPTION 'لا يوجد جدول items أو products';
    END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION explode_bom IS 'فك قائمة المواد متعددة المستويات';

-- 9. دالة حساب التكلفة الإجمالية للـ BOM
-- =============================================
CREATE OR REPLACE FUNCTION calculate_bom_cost(
    p_bom_id UUID,
    p_quantity NUMERIC DEFAULT 1
)
RETURNS NUMERIC AS $$
DECLARE
    v_total_cost NUMERIC := 0;
    items_table_exists BOOLEAN;
BEGIN
    -- تحديد الجدول المستخدم
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'items'
    ) INTO items_table_exists;

    IF items_table_exists THEN
        -- استخدام items
        SELECT COALESCE(SUM(
            eb.quantity_required * 
            COALESCE(i.unit_cost, i.standard_cost, i.cost_price, 0)
        ), 0)
        INTO v_total_cost
        FROM explode_bom(p_bom_id, p_quantity) eb
        LEFT JOIN items i ON i.id = eb.item_id;
    ELSE
        -- استخدام products
        SELECT COALESCE(SUM(
            eb.quantity_required * 
            COALESCE(p.unit_cost, p.standard_cost, p.cost_price, 0)
        ), 0)
        INTO v_total_cost
        FROM explode_bom(p_bom_id, p_quantity) eb
        LEFT JOIN products p ON p.id = eb.item_id;
    END IF;
    
    RETURN v_total_cost;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION calculate_bom_cost IS 'حساب التكلفة الإجمالية لقائمة المواد';

-- 10. دالة Where-Used Report
-- =============================================
CREATE OR REPLACE FUNCTION get_where_used(
    p_item_id UUID,
    p_org_id UUID DEFAULT NULL
)
RETURNS TABLE (
    parent_bom_id UUID,
    parent_item_code VARCHAR,
    parent_item_name VARCHAR,
    quantity_per NUMERIC,
    bom_status VARCHAR,
    is_active BOOLEAN
) AS $$
DECLARE
    items_table_exists BOOLEAN;
BEGIN
    -- تحديد الجدول المستخدم
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'items'
    ) INTO items_table_exists;

    IF items_table_exists THEN
        -- استخدام items
        RETURN QUERY
        SELECT 
            wu.parent_bom_id,
            COALESCE(i.code, i.item_code)::VARCHAR AS parent_item_code,
            COALESCE(i.name, i.item_name)::VARCHAR AS parent_item_name,
            wu.quantity_per,
            bh.status AS bom_status,
            bh.is_active
        FROM bom_where_used wu
        JOIN bom_headers bh ON bh.id = wu.parent_bom_id
        JOIN items i ON i.id = wu.parent_item_id
        WHERE wu.component_id = p_item_id
        AND (p_org_id IS NULL OR wu.org_id = p_org_id)
        ORDER BY COALESCE(i.code, i.item_code);
    ELSE
        -- استخدام products
        RETURN QUERY
        SELECT 
            wu.parent_bom_id,
            COALESCE(p.code, p.product_code)::VARCHAR AS parent_item_code,
            COALESCE(p.name, p.product_name)::VARCHAR AS parent_item_name,
            wu.quantity_per,
            bh.status AS bom_status,
            bh.is_active
        FROM bom_where_used wu
        JOIN bom_headers bh ON bh.id = wu.parent_bom_id
        JOIN products p ON p.id = wu.parent_item_id
        WHERE wu.component_id = p_item_id
        AND (p_org_id IS NULL OR wu.org_id = p_org_id)
        ORDER BY COALESCE(p.code, p.product_code);
    END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_where_used IS 'عرض استخدام المكون في قوائم المواد المختلفة';

-- 11. إضافة Row Level Security (RLS)
-- =============================================
ALTER TABLE bom_headers ENABLE ROW LEVEL SECURITY;
ALTER TABLE bom_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE bom_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bom_explosion_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE bom_where_used ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (لتجنب الأخطاء عند إعادة التشغيل)
DROP POLICY IF EXISTS bom_headers_select_policy ON bom_headers;
DROP POLICY IF EXISTS bom_lines_select_policy ON bom_lines;
DROP POLICY IF EXISTS bom_versions_select_policy ON bom_versions;
DROP POLICY IF EXISTS bom_explosion_select_policy ON bom_explosion_cache;
DROP POLICY IF EXISTS bom_where_used_select_policy ON bom_where_used;

-- سياسات للقراءة - استخدام org_id (تأكد من اسم العمود الصحيح)
CREATE POLICY bom_headers_select_policy ON bom_headers
    FOR SELECT USING (
        org_id IN (
            SELECT org_id FROM user_organizations 
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY bom_lines_select_policy ON bom_lines
    FOR SELECT USING (
        org_id IN (
            SELECT org_id FROM user_organizations 
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY bom_versions_select_policy ON bom_versions
    FOR SELECT USING (
        org_id IN (
            SELECT org_id FROM user_organizations 
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY bom_explosion_select_policy ON bom_explosion_cache
    FOR SELECT USING (
        org_id IN (
            SELECT org_id FROM user_organizations 
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY bom_where_used_select_policy ON bom_where_used
    FOR SELECT USING (
        org_id IN (
            SELECT org_id FROM user_organizations 
            WHERE user_id = auth.uid()
        )
    );

-- سياسات للكتابة (INSERT, UPDATE, DELETE)
CREATE POLICY bom_headers_write_policy ON bom_headers
    FOR ALL USING (
        org_id IN (
            SELECT org_id FROM user_organizations 
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY bom_lines_write_policy ON bom_lines
    FOR ALL USING (
        org_id IN (
            SELECT org_id FROM user_organizations 
            WHERE user_id = auth.uid()
        )
    );

-- 12. إنشاء فهارس للأداء
-- =============================================
CREATE INDEX IF NOT EXISTS idx_bom_headers_status ON bom_headers(status);
CREATE INDEX IF NOT EXISTS idx_bom_headers_active ON bom_headers(is_active);
CREATE INDEX IF NOT EXISTS idx_bom_headers_item ON bom_headers(item_id);
CREATE INDEX IF NOT EXISTS idx_bom_lines_bom ON bom_lines(bom_id);
CREATE INDEX IF NOT EXISTS idx_bom_lines_item ON bom_lines(item_id);
CREATE INDEX IF NOT EXISTS idx_bom_versions_bom ON bom_versions(bom_id);

-- =============================================
-- انتهى إعداد نظام BOM
-- =============================================

-- عرض النتائج
SELECT 'BOM System Setup Complete!' AS status;
SELECT 'Tables Created/Updated: bom_headers, bom_lines' AS info;
SELECT 'Tables Created: bom_versions, bom_explosion_cache, bom_where_used' AS info;
SELECT 'Functions Created: explode_bom, calculate_bom_cost, get_where_used' AS info;
SELECT 'Triggers Created: trg_bom_version_tracking, trg_bom_where_used_update' AS info;

-- =============================================
-- تعليمات التنفيذ:
-- 1. انسخ محتوى هذا الملف بالكامل
-- 2. افتح Supabase Dashboard → SQL Editor
-- 3. الصق الكود وشغّل "Run"
-- 4. تأكد من ظهور رسالة "BOM System Setup Complete!"
-- =============================================
