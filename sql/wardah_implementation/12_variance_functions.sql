-- =======================================
-- 4. VARIANCE ANALYSIS FUNCTIONS
-- =======================================

-- Function: Calculate overhead variances at period end
CREATE OR REPLACE FUNCTION calculate_overhead_variances(
    p_org_id UUID,
    p_period_start DATE,
    p_period_end DATE
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_actual_overhead DECIMAL(18,6);
    v_applied_overhead DECIMAL(18,6);
    v_spending_variance DECIMAL(18,6);
    v_volume_variance DECIMAL(18,6);
    v_total_variance DECIMAL(18,6);
BEGIN
    -- Calculate actual overhead (debit balance in OH control accounts)
    SELECT COALESCE(SUM(
        CASE WHEN ga.normal_balance = 'DEBIT' THEN sm.total_cost ELSE -sm.total_cost END
    ), 0) INTO v_actual_overhead
    FROM stock_moves sm
    JOIN gl_mappings gm ON gm.debit_account_code = ANY(ARRAY['513100', '513200', '513300', '513400', '513500', '513600'])
    JOIN gl_accounts ga ON ga.code = gm.debit_account_code AND ga.org_id = p_org_id
    WHERE sm.org_id = p_org_id
    AND sm.date_done BETWEEN p_period_start AND p_period_end;
    
    -- Calculate applied overhead (credit balance in applied OH account)
    SELECT COALESCE(SUM(total_overhead), 0) INTO v_applied_overhead
    FROM overhead_allocations oa
    JOIN manufacturing_orders mo ON mo.id = oa.mo_id
    WHERE oa.org_id = p_org_id
    AND mo.date_finished BETWEEN p_period_start AND p_period_end;
    
    -- Calculate variances
    v_total_variance := v_actual_overhead - v_applied_overhead;
    v_spending_variance := v_total_variance * 0.7; -- Simplified allocation
    v_volume_variance := v_total_variance * 0.3;
    
    RETURN jsonb_build_object(
        'period_start', p_period_start,
        'period_end', p_period_end,
        'actual_overhead', v_actual_overhead,
        'applied_overhead', v_applied_overhead,
        'total_variance', v_total_variance,
        'spending_variance', v_spending_variance,
        'volume_variance', v_volume_variance,
        'variance_analysis', CASE 
            WHEN v_total_variance > 0 THEN 'Under-applied (Actual > Applied)'
            WHEN v_total_variance < 0 THEN 'Over-applied (Applied > Actual)'
            ELSE 'No variance'
        END
    );
END;
$$;