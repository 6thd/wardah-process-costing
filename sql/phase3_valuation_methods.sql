-- =====================================================
-- Phase 3: Advanced Valuation Methods
-- Add support for FIFO, LIFO, and Moving Average
-- =====================================================

-- =====================================================
-- STEP 1: Add Valuation Method to Products
-- =====================================================

-- Create ENUM type for valuation methods
DO $$ BEGIN
    CREATE TYPE valuation_method_enum AS ENUM (
        'Weighted Average',  -- Default: AVCO (Average Cost)
        'FIFO',              -- First In First Out
        'LIFO',              -- Last In First Out
        'Moving Average'     -- Continuous weighted average
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Add valuation_method column to products table
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS valuation_method valuation_method_enum DEFAULT 'Weighted Average';

-- Create index for filtering by valuation method
CREATE INDEX IF NOT EXISTS idx_products_valuation_method 
    ON products(valuation_method);

-- Add comment
COMMENT ON COLUMN products.valuation_method IS 'Inventory valuation method: Weighted Average, FIFO, LIFO, or Moving Average';

-- Update existing products to use Weighted Average (default)
UPDATE products
SET valuation_method = 'Weighted Average'
WHERE valuation_method IS NULL;

-- =====================================================
-- STEP 2: Verify stock_queue fields exist
-- =====================================================
-- These were already added in Phase 2, just verifying

-- Verify stock_ledger_entries.stock_queue exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'stock_ledger_entries' 
        AND column_name = 'stock_queue'
    ) THEN
        RAISE EXCEPTION 'stock_queue column missing in stock_ledger_entries';
    END IF;
END $$;

-- Verify bins.stock_queue exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'bins' 
        AND column_name = 'stock_queue'
    ) THEN
        RAISE EXCEPTION 'stock_queue column missing in bins';
    END IF;
END $$;

-- =====================================================
-- STEP 3: Helper Functions for Valuation
-- =====================================================

-- Function to calculate FIFO valuation rate
-- Returns the rate of the oldest batch in queue
CREATE OR REPLACE FUNCTION get_fifo_rate(p_stock_queue JSONB)
RETURNS DECIMAL(15, 4) AS $$
DECLARE
    v_queue_array JSONB;
    v_first_batch JSONB;
BEGIN
    -- stock_queue format: [{"qty": 100, "rate": 45.5}, {"qty": 50, "rate": 50.0}, ...]
    
    IF p_stock_queue IS NULL OR jsonb_array_length(p_stock_queue) = 0 THEN
        RETURN 0;
    END IF;
    
    -- Get first element (oldest batch)
    v_first_batch := p_stock_queue->0;
    
    RETURN (v_first_batch->>'rate')::DECIMAL(15, 4);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to calculate LIFO valuation rate
-- Returns the rate of the newest batch in queue
CREATE OR REPLACE FUNCTION get_lifo_rate(p_stock_queue JSONB)
RETURNS DECIMAL(15, 4) AS $$
DECLARE
    v_queue_length INTEGER;
    v_last_batch JSONB;
BEGIN
    IF p_stock_queue IS NULL OR jsonb_array_length(p_stock_queue) = 0 THEN
        RETURN 0;
    END IF;
    
    -- Get last element (newest batch)
    v_queue_length := jsonb_array_length(p_stock_queue);
    v_last_batch := p_stock_queue->(v_queue_length - 1);
    
    RETURN (v_last_batch->>'rate')::DECIMAL(15, 4);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to calculate weighted average from queue
CREATE OR REPLACE FUNCTION get_weighted_average_from_queue(p_stock_queue JSONB)
RETURNS DECIMAL(15, 4) AS $$
DECLARE
    v_total_qty DECIMAL(15, 4) := 0;
    v_total_value DECIMAL(20, 4) := 0;
    v_batch JSONB;
    v_qty DECIMAL(15, 4);
    v_rate DECIMAL(15, 4);
BEGIN
    IF p_stock_queue IS NULL OR jsonb_array_length(p_stock_queue) = 0 THEN
        RETURN 0;
    END IF;
    
    -- Calculate weighted average from all batches
    FOR v_batch IN SELECT * FROM jsonb_array_elements(p_stock_queue)
    LOOP
        v_qty := (v_batch->>'qty')::DECIMAL(15, 4);
        v_rate := (v_batch->>'rate')::DECIMAL(15, 4);
        
        v_total_qty := v_total_qty + v_qty;
        v_total_value := v_total_value + (v_qty * v_rate);
    END LOOP;
    
    IF v_total_qty > 0 THEN
        RETURN v_total_value / v_total_qty;
    ELSE
        RETURN 0;
    END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- =====================================================
-- STEP 4: Update get_stock_balance function to support all methods
-- =====================================================

CREATE OR REPLACE FUNCTION get_stock_balance_with_method(
    p_product_id UUID,
    p_warehouse_id UUID,
    p_valuation_method TEXT DEFAULT 'Weighted Average'
)
RETURNS TABLE (
    quantity DECIMAL(15, 4),
    valuation_rate DECIMAL(15, 4),
    stock_value DECIMAL(20, 4),
    stock_queue JSONB
) AS $$
DECLARE
    v_bin RECORD;
    v_calculated_rate DECIMAL(15, 4);
BEGIN
    -- Get bin data
    SELECT * INTO v_bin
    FROM bins b
    WHERE b.product_id = p_product_id
      AND b.warehouse_id = p_warehouse_id;
    
    IF NOT FOUND THEN
        RETURN QUERY SELECT 
            0::DECIMAL(15, 4),
            0::DECIMAL(15, 4),
            0::DECIMAL(20, 4),
            NULL::JSONB;
        RETURN;
    END IF;
    
    -- Calculate rate based on valuation method
    v_calculated_rate := CASE 
        WHEN p_valuation_method = 'FIFO' THEN get_fifo_rate(v_bin.stock_queue)
        WHEN p_valuation_method = 'LIFO' THEN get_lifo_rate(v_bin.stock_queue)
        WHEN p_valuation_method IN ('Moving Average', 'Weighted Average') THEN v_bin.valuation_rate
        ELSE v_bin.valuation_rate
    END;
    
    RETURN QUERY SELECT 
        COALESCE(v_bin.actual_qty, 0),
        COALESCE(v_calculated_rate, 0),
        COALESCE(v_bin.actual_qty * v_calculated_rate, 0),
        v_bin.stock_queue;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- STEP 5: Add triggers for automatic valuation (optional)
-- =====================================================

-- This can be implemented later for automatic revaluation
-- when valuation method changes

-- =====================================================
-- STEP 6: Comments and Documentation
-- =====================================================

COMMENT ON TYPE valuation_method_enum IS 'Inventory valuation methods: Weighted Average (AVCO), FIFO, LIFO, Moving Average';
COMMENT ON FUNCTION get_fifo_rate IS 'Get valuation rate using FIFO method (first batch rate)';
COMMENT ON FUNCTION get_lifo_rate IS 'Get valuation rate using LIFO method (last batch rate)';
COMMENT ON FUNCTION get_weighted_average_from_queue IS 'Calculate weighted average rate from stock queue';
COMMENT ON FUNCTION get_stock_balance_with_method IS 'Get stock balance with specific valuation method applied';

-- =====================================================
-- STEP 7: Sample Data for Testing (Optional)
-- =====================================================

-- Example: Set some products to different valuation methods
-- UPDATE products SET valuation_method = 'FIFO' WHERE category_id = (SELECT id FROM categories WHERE code = 'RM' LIMIT 1);
-- UPDATE products SET valuation_method = 'LIFO' WHERE category_id = (SELECT id FROM categories WHERE code = 'FG' LIMIT 1);

-- =====================================================
-- Verification
-- =====================================================

DO $$
DECLARE
    v_column_exists BOOLEAN;
    v_function_count INTEGER;
BEGIN
    -- Check valuation_method column
    SELECT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'products' 
        AND column_name = 'valuation_method'
    ) INTO v_column_exists;
    
    IF NOT v_column_exists THEN
        RAISE EXCEPTION '❌ valuation_method column not added to products table';
    END IF;
    
    -- Check functions created
    SELECT COUNT(*) INTO v_function_count
    FROM pg_proc 
    WHERE proname IN ('get_fifo_rate', 'get_lifo_rate', 'get_weighted_average_from_queue', 'get_stock_balance_with_method');
    
    IF v_function_count < 4 THEN
        RAISE EXCEPTION '❌ Not all valuation functions created';
    END IF;
    
    RAISE NOTICE '✅ Phase 3 migration successful!';
    RAISE NOTICE '✅ valuation_method column added to products';
    RAISE NOTICE '✅ ENUM type created: valuation_method_enum';
    RAISE NOTICE '✅ 4 valuation functions created';
    RAISE NOTICE '✅ Ready for FIFO, LIFO, and Moving Average valuation';
END $$;

-- =====================================================
-- Usage Examples (Documentation)
-- =====================================================

/*

-- Get stock balance using FIFO method
SELECT * FROM get_stock_balance_with_method(
    'product-uuid-here',
    'warehouse-uuid-here',
    'FIFO'
);

-- Get stock balance using LIFO method
SELECT * FROM get_stock_balance_with_method(
    'product-uuid-here',
    'warehouse-uuid-here',
    'LIFO'
);

-- Update product to use FIFO
UPDATE products 
SET valuation_method = 'FIFO' 
WHERE code = 'RM-001';

-- Query products by valuation method
SELECT code, name, valuation_method 
FROM products 
WHERE valuation_method = 'FIFO';

-- Stock queue example structure
-- [
--   {"qty": 100, "rate": 45.50},
--   {"qty": 50, "rate": 48.00},
--   {"qty": 75, "rate": 52.00}
-- ]
-- FIFO uses first: 45.50
-- LIFO uses last: 52.00
-- Weighted Avg: (100*45.50 + 50*48.00 + 75*52.00) / 225 = 47.89

*/
