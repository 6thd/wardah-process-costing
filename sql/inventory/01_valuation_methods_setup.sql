-- =====================================================
-- Inventory Valuation System Enhancement
-- Add support for FIFO, LIFO, and Weighted Average
-- =====================================================

-- 1. Add valuation method column to products table
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS valuation_method VARCHAR(50) DEFAULT 'Weighted Average'
  CHECK (valuation_method IN ('Weighted Average', 'FIFO', 'LIFO', 'Moving Average'));

-- 2. Add stock queue column (JSONB) to store batches for FIFO/LIFO
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS stock_queue JSONB DEFAULT '[]'::jsonb;

-- 3. Add stock value column (calculated from queue or qty × cost)
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS stock_value DECIMAL(18, 6) DEFAULT 0;

-- 4. Create index on valuation method for reporting
CREATE INDEX IF NOT EXISTS idx_products_valuation_method 
ON products(valuation_method);

-- 5. Create index on stock queue for JSONB queries
CREATE INDEX IF NOT EXISTS idx_products_stock_queue 
ON products USING GIN (stock_queue);

-- 6. Update existing products with default values
UPDATE products 
SET 
  valuation_method = 'Weighted Average',
  stock_queue = jsonb_build_array(
    jsonb_build_object(
      'qty', COALESCE(stock_quantity, 0),
      'rate', COALESCE(cost_price, 0)
    )
  ),
  stock_value = COALESCE(stock_quantity, 0) * COALESCE(cost_price, 0)
WHERE valuation_method IS NULL;

-- 7. Create function to validate stock queue integrity
CREATE OR REPLACE FUNCTION validate_stock_queue()
RETURNS TRIGGER AS $$
DECLARE
  queue_qty DECIMAL(18, 6);
  queue_value DECIMAL(18, 6);
  batch JSONB;
BEGIN
  -- Calculate totals from queue
  queue_qty := 0;
  queue_value := 0;
  
  FOR batch IN SELECT jsonb_array_elements(NEW.stock_queue)
  LOOP
    queue_qty := queue_qty + (batch->>'qty')::DECIMAL;
    queue_value := queue_value + ((batch->>'qty')::DECIMAL * (batch->>'rate')::DECIMAL);
  END LOOP;
  
  -- Update stock_quantity and stock_value from queue
  NEW.stock_quantity := queue_qty;
  NEW.stock_value := queue_value;
  
  -- For weighted average, ensure cost_price matches
  IF NEW.valuation_method IN ('Weighted Average', 'Moving Average') AND queue_qty > 0 THEN
    NEW.cost_price := queue_value / queue_qty;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 8. Create trigger to validate queue on update
DROP TRIGGER IF EXISTS trg_validate_stock_queue ON products;
CREATE TRIGGER trg_validate_stock_queue
BEFORE INSERT OR UPDATE OF stock_queue ON products
FOR EACH ROW
EXECUTE FUNCTION validate_stock_queue();

-- 9. Create view for stock valuation summary by method
CREATE OR REPLACE VIEW vw_stock_valuation_by_method AS
SELECT 
  valuation_method,
  COUNT(*) as product_count,
  SUM(stock_quantity) as total_quantity,
  SUM(stock_value) as total_value,
  AVG(cost_price) as avg_unit_cost,
  MIN(cost_price) as min_unit_cost,
  MAX(cost_price) as max_unit_cost
FROM products
WHERE stock_quantity > 0
GROUP BY valuation_method;

-- 10. Create function to get batch details for FIFO/LIFO products
CREATE OR REPLACE FUNCTION get_product_batches(p_product_id UUID)
RETURNS TABLE (
  batch_no INT,
  qty DECIMAL(18, 6),
  rate DECIMAL(18, 6),
  value DECIMAL(18, 6),
  age_days INT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ROW_NUMBER() OVER ()::INT as batch_no,
    (batch->>'qty')::DECIMAL as qty,
    (batch->>'rate')::DECIMAL as rate,
    ((batch->>'qty')::DECIMAL * (batch->>'rate')::DECIMAL) as value,
    NULL::INT as age_days -- Can be enhanced with timestamp if needed
  FROM (
    SELECT jsonb_array_elements(stock_queue) as batch
    FROM products
    WHERE id = p_product_id
  ) batches;
END;
$$ LANGUAGE plpgsql;

-- 11. Create function to simulate COGS calculation
CREATE OR REPLACE FUNCTION simulate_cogs(
  p_product_id UUID,
  p_quantity DECIMAL(18, 6)
)
RETURNS TABLE (
  method VARCHAR(50),
  cogs DECIMAL(18, 6),
  avg_rate DECIMAL(18, 6),
  remaining_qty DECIMAL(18, 6),
  remaining_value DECIMAL(18, 6)
) AS $$
DECLARE
  v_product RECORD;
  v_remaining DECIMAL(18, 6);
  v_total_cost DECIMAL(18, 6);
  v_batch JSONB;
BEGIN
  -- Get product details
  SELECT * INTO v_product
  FROM products
  WHERE id = p_product_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found';
  END IF;
  
  IF v_product.stock_quantity < p_quantity THEN
    RAISE EXCEPTION 'Insufficient stock';
  END IF;
  
  -- Initialize
  v_remaining := p_quantity;
  v_total_cost := 0;
  
  -- FIFO Simulation (from start of queue)
  IF v_product.valuation_method = 'FIFO' THEN
    FOR v_batch IN 
      SELECT value 
      FROM jsonb_array_elements(v_product.stock_queue)
      ORDER BY ordinality
    LOOP
      IF v_remaining <= 0 THEN EXIT; END IF;
      
      DECLARE
        batch_qty DECIMAL := (v_batch->>'qty')::DECIMAL;
        batch_rate DECIMAL := (v_batch->>'rate')::DECIMAL;
        take_qty DECIMAL;
      BEGIN
        take_qty := LEAST(batch_qty, v_remaining);
        v_total_cost := v_total_cost + (take_qty * batch_rate);
        v_remaining := v_remaining - take_qty;
      END;
    END LOOP;
  
  -- LIFO Simulation (from end of queue)
  ELSIF v_product.valuation_method = 'LIFO' THEN
    FOR v_batch IN 
      SELECT value 
      FROM jsonb_array_elements(v_product.stock_queue)
      ORDER BY ordinality DESC
    LOOP
      IF v_remaining <= 0 THEN EXIT; END IF;
      
      DECLARE
        batch_qty DECIMAL := (v_batch->>'qty')::DECIMAL;
        batch_rate DECIMAL := (v_batch->>'rate')::DECIMAL;
        take_qty DECIMAL;
      BEGIN
        take_qty := LEAST(batch_qty, v_remaining);
        v_total_cost := v_total_cost + (take_qty * batch_rate);
        v_remaining := v_remaining - take_qty;
      END;
    END LOOP;
  
  -- Weighted Average (simple calculation)
  ELSE
    v_total_cost := p_quantity * v_product.cost_price;
  END IF;
  
  -- Return results
  RETURN QUERY SELECT 
    v_product.valuation_method,
    v_total_cost as cogs,
    (v_total_cost / p_quantity) as avg_rate,
    (v_product.stock_quantity - p_quantity) as remaining_qty,
    (v_product.stock_value - v_total_cost) as remaining_value;
END;
$$ LANGUAGE plpgsql;

-- 12. Add comments for documentation
COMMENT ON COLUMN products.valuation_method IS 'Inventory valuation method: Weighted Average (default), FIFO, LIFO, or Moving Average';
COMMENT ON COLUMN products.stock_queue IS 'JSONB array of stock batches for FIFO/LIFO. Format: [{"qty": 100, "rate": 45.50}, ...]';
COMMENT ON COLUMN products.stock_value IS 'Total stock value calculated from queue (qty × rate for all batches)';

COMMENT ON FUNCTION get_product_batches(UUID) IS 'Returns all stock batches for a product with batch number, quantity, rate, and value';
COMMENT ON FUNCTION simulate_cogs(UUID, DECIMAL) IS 'Simulates COGS calculation for a given quantity without actually updating the stock';

-- 13. Grant permissions
GRANT SELECT ON vw_stock_valuation_by_method TO authenticated;
GRANT EXECUTE ON FUNCTION get_product_batches(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION simulate_cogs(UUID, DECIMAL) TO authenticated;

-- =====================================================
-- Verification Queries
-- =====================================================

-- Check valuation methods distribution
-- SELECT * FROM vw_stock_valuation_by_method;

-- Get batches for a specific product
-- SELECT * FROM get_product_batches('product-id-here');

-- Simulate COGS calculation
-- SELECT * FROM simulate_cogs('product-id-here', 50);

-- Check products with multiple batches (FIFO/LIFO)
-- SELECT 
--   code, 
--   name, 
--   valuation_method,
--   stock_quantity,
--   cost_price,
--   stock_value,
--   jsonb_array_length(stock_queue) as batch_count
-- FROM products
-- WHERE jsonb_array_length(stock_queue) > 1
-- ORDER BY batch_count DESC;
