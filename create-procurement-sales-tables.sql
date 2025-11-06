-- =======================================
-- إنشاء جداول موديولات المشتريات والمبيعات
-- للدورة المستندية المحاسبية الكاملة
-- =======================================

-- =======================================
-- 1. جداول المشتريات (Procurement)
-- =======================================

-- 1.1 بنود أمر الشراء
CREATE TABLE IF NOT EXISTS purchase_order_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    line_number INTEGER NOT NULL,
    product_id UUID NOT NULL REFERENCES products(id),
    description TEXT,
    quantity DECIMAL(12,2) NOT NULL CHECK (quantity > 0),
    unit_price DECIMAL(12,4) NOT NULL CHECK (unit_price >= 0),
    discount_percent DECIMAL(5,2) DEFAULT 0 CHECK (discount_percent >= 0 AND discount_percent <= 100),
    tax_percent DECIMAL(5,2) DEFAULT 15 CHECK (tax_percent >= 0),
    line_total DECIMAL(12,2) GENERATED ALWAYS AS (
        quantity * unit_price * (1 - discount_percent/100) * (1 + tax_percent/100)
    ) STORED,
    received_quantity DECIMAL(12,2) DEFAULT 0 CHECK (received_quantity >= 0),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(purchase_order_id, line_number)
);

-- 1.2 سندات استلام البضائع
CREATE TABLE IF NOT EXISTS goods_receipts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    receipt_number VARCHAR(50) NOT NULL,
    purchase_order_id UUID REFERENCES purchase_orders(id),
    vendor_id UUID NOT NULL REFERENCES vendors(id),
    receipt_date DATE NOT NULL,
    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'cancelled')),
    notes TEXT,
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, receipt_number)
);

-- 1.3 بنود سندات استلام البضائع
CREATE TABLE IF NOT EXISTS goods_receipt_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    receipt_id UUID NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
    po_line_id UUID REFERENCES purchase_order_lines(id),
    product_id UUID NOT NULL REFERENCES products(id),
    quantity_received DECIMAL(12,2) NOT NULL CHECK (quantity_received > 0),
    unit_cost DECIMAL(12,4) NOT NULL CHECK (unit_cost >= 0),
    quality_status VARCHAR(20) DEFAULT 'approved' CHECK (quality_status IN ('approved', 'rejected', 'pending')),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1.4 فواتير الموردين
CREATE TABLE IF NOT EXISTS supplier_invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    invoice_number VARCHAR(50) NOT NULL,
    supplier_invoice_number VARCHAR(50),
    vendor_id UUID NOT NULL REFERENCES vendors(id),
    purchase_order_id UUID REFERENCES purchase_orders(id),
    receipt_id UUID REFERENCES goods_receipts(id),
    invoice_date DATE NOT NULL,
    due_date DATE,
    subtotal DECIMAL(12,2) NOT NULL CHECK (subtotal >= 0),
    tax_amount DECIMAL(12,2) DEFAULT 0 CHECK (tax_amount >= 0),
    discount_amount DECIMAL(12,2) DEFAULT 0 CHECK (discount_amount >= 0),
    total_amount DECIMAL(12,2) NOT NULL CHECK (total_amount >= 0),
    paid_amount DECIMAL(12,2) DEFAULT 0 CHECK (paid_amount >= 0),
    balance DECIMAL(12,2) GENERATED ALWAYS AS (total_amount - paid_amount) STORED,
    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'paid', 'cancelled')),
    gl_entry_id UUID,
    payment_terms VARCHAR(100),
    notes TEXT,
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, invoice_number)
);

-- 1.5 بنود فواتير الموردين
CREATE TABLE IF NOT EXISTS supplier_invoice_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    invoice_id UUID NOT NULL REFERENCES supplier_invoices(id) ON DELETE CASCADE,
    line_number INTEGER NOT NULL,
    product_id UUID NOT NULL REFERENCES products(id),
    description TEXT,
    quantity DECIMAL(12,2) NOT NULL CHECK (quantity > 0),
    unit_price DECIMAL(12,4) NOT NULL CHECK (unit_price >= 0),
    discount_percent DECIMAL(5,2) DEFAULT 0,
    tax_percent DECIMAL(5,2) DEFAULT 15,
    line_total DECIMAL(12,2) GENERATED ALWAYS AS (
        quantity * unit_price * (1 - discount_percent/100) * (1 + tax_percent/100)
    ) STORED,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(invoice_id, line_number)
);

-- =======================================
-- 2. جداول المبيعات (Sales)
-- =======================================

-- 2.1 فواتير المبيعات (تحديث الجدول الموجود أو إنشاء جديد)
CREATE TABLE IF NOT EXISTS sales_invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    invoice_number VARCHAR(50) NOT NULL,
    customer_id UUID NOT NULL REFERENCES customers(id),
    invoice_date DATE NOT NULL,
    due_date DATE,
    subtotal DECIMAL(12,2) NOT NULL CHECK (subtotal >= 0),
    tax_amount DECIMAL(12,2) DEFAULT 0 CHECK (tax_amount >= 0),
    discount_amount DECIMAL(12,2) DEFAULT 0 CHECK (discount_amount >= 0),
    total_amount DECIMAL(12,2) NOT NULL CHECK (total_amount >= 0),
    paid_amount DECIMAL(12,2) DEFAULT 0 CHECK (paid_amount >= 0),
    balance DECIMAL(12,2) GENERATED ALWAYS AS (total_amount - paid_amount) STORED,
    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'cancelled')),
    delivery_status VARCHAR(20) DEFAULT 'pending' CHECK (delivery_status IN ('pending', 'partial', 'delivered')),
    gl_entry_id UUID,
    cogs_entry_id UUID,
    payment_terms VARCHAR(100),
    notes TEXT,
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, invoice_number)
);

-- 2.2 بنود فواتير المبيعات
CREATE TABLE IF NOT EXISTS sales_invoice_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    invoice_id UUID NOT NULL REFERENCES sales_invoices(id) ON DELETE CASCADE,
    line_number INTEGER NOT NULL,
    product_id UUID NOT NULL REFERENCES products(id),
    description TEXT,
    quantity DECIMAL(12,2) NOT NULL CHECK (quantity > 0),
    unit_price DECIMAL(12,4) NOT NULL CHECK (unit_price >= 0),
    unit_cost DECIMAL(12,4),
    discount_percent DECIMAL(5,2) DEFAULT 0 CHECK (discount_percent >= 0 AND discount_percent <= 100),
    tax_percent DECIMAL(5,2) DEFAULT 15 CHECK (tax_percent >= 0),
    line_total DECIMAL(12,2) GENERATED ALWAYS AS (
        quantity * unit_price * (1 - discount_percent/100) * (1 + tax_percent/100)
    ) STORED,
    cogs DECIMAL(12,2) GENERATED ALWAYS AS (quantity * COALESCE(unit_cost, 0)) STORED,
    delivered_quantity DECIMAL(12,2) DEFAULT 0 CHECK (delivered_quantity >= 0),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(invoice_id, line_number)
);

-- 2.3 مذكرات التسليم
CREATE TABLE IF NOT EXISTS delivery_notes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    delivery_number VARCHAR(50) NOT NULL,
    invoice_id UUID REFERENCES sales_invoices(id),
    customer_id UUID NOT NULL REFERENCES customers(id),
    delivery_date DATE NOT NULL,
    driver_name VARCHAR(100),
    vehicle_number VARCHAR(50),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'in_transit', 'delivered', 'failed')),
    notes TEXT,
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, delivery_number)
);

-- 2.4 بنود مذكرات التسليم
CREATE TABLE IF NOT EXISTS delivery_note_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    delivery_id UUID NOT NULL REFERENCES delivery_notes(id) ON DELETE CASCADE,
    invoice_line_id UUID REFERENCES sales_invoice_lines(id),
    product_id UUID NOT NULL REFERENCES products(id),
    quantity_delivered DECIMAL(12,2) NOT NULL CHECK (quantity_delivered > 0),
    unit_cost_at_delivery DECIMAL(12,4),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =======================================
-- 3. Indexes للأداء
-- =======================================

-- Purchase Order Lines
CREATE INDEX IF NOT EXISTS idx_po_lines_org ON purchase_order_lines(org_id);
CREATE INDEX IF NOT EXISTS idx_po_lines_order ON purchase_order_lines(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_po_lines_product ON purchase_order_lines(product_id);

-- Goods Receipts
CREATE INDEX IF NOT EXISTS idx_goods_receipts_org ON goods_receipts(org_id);
CREATE INDEX IF NOT EXISTS idx_goods_receipts_vendor ON goods_receipts(vendor_id);
CREATE INDEX IF NOT EXISTS idx_goods_receipts_po ON goods_receipts(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_goods_receipts_date ON goods_receipts(receipt_date);

-- Goods Receipt Lines
CREATE INDEX IF NOT EXISTS idx_gr_lines_org ON goods_receipt_lines(org_id);
CREATE INDEX IF NOT EXISTS idx_gr_lines_receipt ON goods_receipt_lines(receipt_id);
CREATE INDEX IF NOT EXISTS idx_gr_lines_product ON goods_receipt_lines(product_id);

-- Supplier Invoices
CREATE INDEX IF NOT EXISTS idx_supplier_invoices_org ON supplier_invoices(org_id);
CREATE INDEX IF NOT EXISTS idx_supplier_invoices_vendor ON supplier_invoices(vendor_id);
CREATE INDEX IF NOT EXISTS idx_supplier_invoices_date ON supplier_invoices(invoice_date);
CREATE INDEX IF NOT EXISTS idx_supplier_invoices_status ON supplier_invoices(status);

-- Sales Invoices
CREATE INDEX IF NOT EXISTS idx_sales_invoices_org ON sales_invoices(org_id);
CREATE INDEX IF NOT EXISTS idx_sales_invoices_customer ON sales_invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_invoices_date ON sales_invoices(invoice_date);
CREATE INDEX IF NOT EXISTS idx_sales_invoices_status ON sales_invoices(status);

-- Sales Invoice Lines
CREATE INDEX IF NOT EXISTS idx_sales_lines_org ON sales_invoice_lines(org_id);
CREATE INDEX IF NOT EXISTS idx_sales_lines_invoice ON sales_invoice_lines(invoice_id);
CREATE INDEX IF NOT EXISTS idx_sales_lines_product ON sales_invoice_lines(product_id);

-- Delivery Notes
CREATE INDEX IF NOT EXISTS idx_delivery_notes_org ON delivery_notes(org_id);
CREATE INDEX IF NOT EXISTS idx_delivery_notes_customer ON delivery_notes(customer_id);
CREATE INDEX IF NOT EXISTS idx_delivery_notes_invoice ON delivery_notes(invoice_id);
CREATE INDEX IF NOT EXISTS idx_delivery_notes_date ON delivery_notes(delivery_date);

-- Delivery Note Lines
CREATE INDEX IF NOT EXISTS idx_delivery_lines_org ON delivery_note_lines(org_id);
CREATE INDEX IF NOT EXISTS idx_delivery_lines_delivery ON delivery_note_lines(delivery_id);
CREATE INDEX IF NOT EXISTS idx_delivery_lines_product ON delivery_note_lines(product_id);

-- =======================================
-- 4. Row Level Security (RLS)
-- =======================================

ALTER TABLE purchase_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE goods_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE goods_receipt_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_note_lines ENABLE ROW LEVEL SECURITY;

-- Allow All Policies (للتطوير - يجب تحديثها لاحقاً)
CREATE POLICY "Allow all for purchase_order_lines" ON purchase_order_lines FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for goods_receipts" ON goods_receipts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for goods_receipt_lines" ON goods_receipt_lines FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for supplier_invoices" ON supplier_invoices FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for supplier_invoice_lines" ON supplier_invoice_lines FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for sales_invoices" ON sales_invoices FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for sales_invoice_lines" ON sales_invoice_lines FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for delivery_notes" ON delivery_notes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for delivery_note_lines" ON delivery_note_lines FOR ALL USING (true) WITH CHECK (true);

-- =======================================
-- 5. Comments للتوثيق
-- =======================================

COMMENT ON TABLE purchase_order_lines IS 'بنود أوامر الشراء - تفاصيل المنتجات والكميات والأسعار';
COMMENT ON TABLE goods_receipts IS 'سندات استلام البضائع - تسجيل استلام المشتريات';
COMMENT ON TABLE goods_receipt_lines IS 'بنود سندات الاستلام - تفاصيل البضائع المستلمة';
COMMENT ON TABLE supplier_invoices IS 'فواتير الموردين - الفواتير الواردة من الموردين';
COMMENT ON TABLE supplier_invoice_lines IS 'بنود فواتير الموردين - تفاصيل المنتجات المفوترة';
COMMENT ON TABLE sales_invoices IS 'فواتير المبيعات - الفواتير الصادرة للعملاء';
COMMENT ON TABLE sales_invoice_lines IS 'بنود فواتير المبيعات - تفاصيل المنتجات المباعة';
COMMENT ON TABLE delivery_notes IS 'مذكرات التسليم - تسجيل تسليم البضائع للعملاء';
COMMENT ON TABLE delivery_note_lines IS 'بنود مذكرات التسليم - تفاصيل البضائع المسلمة';

-- =======================================
-- 6. Triggers للتحديث التلقائي
-- =======================================

-- Trigger: تحديث updated_at تلقائياً
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_purchase_order_lines_updated_at BEFORE UPDATE ON purchase_order_lines
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_goods_receipts_updated_at BEFORE UPDATE ON goods_receipts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_goods_receipt_lines_updated_at BEFORE UPDATE ON goods_receipt_lines
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_supplier_invoices_updated_at BEFORE UPDATE ON supplier_invoices
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_sales_invoices_updated_at BEFORE UPDATE ON sales_invoices
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_sales_invoice_lines_updated_at BEFORE UPDATE ON sales_invoice_lines
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_delivery_notes_updated_at BEFORE UPDATE ON delivery_notes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_delivery_note_lines_updated_at BEFORE UPDATE ON delivery_note_lines
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =======================================
-- نجاح التنفيذ
-- =======================================

DO $$
BEGIN
    RAISE NOTICE '✅ تم إنشاء جداول موديولات المشتريات والمبيعات بنجاح!';
    RAISE NOTICE '📦 جداول المشتريات: purchase_order_lines, goods_receipts, supplier_invoices';
    RAISE NOTICE '💰 جداول المبيعات: sales_invoices, sales_invoice_lines, delivery_notes';
    RAISE NOTICE '🔒 تم تفعيل RLS على جميع الجداول';
    RAISE NOTICE '📊 تم إنشاء Indexes للأداء الأمثل';
END $$;
