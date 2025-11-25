-- ===================================================================
-- MIGRATION: STAGE_COSTS TO STAGE_WIP_LOG
-- Phase 1: Data Migration Script
-- ===================================================================
-- 
-- This script migrates existing stage_costs data to the new stage_wip_log structure
-- Strategy:
-- 1. Create manufacturing_stages from distinct stage_no values in stage_costs
-- 2. Migrate stage_costs data to stage_wip_log (assuming 1-month periods)
-- 3. Mark stage_costs as migrated (add migrated_to_wip_log flag)
-- 4. Maintain backward compatibility
-- ===================================================================

-- ===================================================================
-- STEP 1: Create manufacturing_stages from existing stage_costs
-- ===================================================================
DO $$
DECLARE
    v_org_id UUID;
    v_stage_no INTEGER;
    v_stage_code VARCHAR(50);
    v_stage_name VARCHAR(255);
    v_work_center_id UUID;
BEGIN
    -- Loop through each org_id and stage_no combination
    FOR v_org_id, v_stage_no IN 
        SELECT DISTINCT org_id, stage_no 
        FROM public.stage_costs 
        WHERE stage_no IS NOT NULL
        ORDER BY org_id, stage_no
    LOOP
        -- Generate stage code and name
        v_stage_code := 'STG-' || LPAD(v_stage_no::text, 3, '0');
        v_stage_name := 'Stage ' || v_stage_no;
        
        -- Try to find a work center for this stage (if any exists)
        SELECT id INTO v_work_center_id
        FROM public.work_centers
        WHERE org_id = v_org_id
        AND seq = v_stage_no
        LIMIT 1;
        
        -- Insert manufacturing stage (ignore if already exists)
        INSERT INTO public.manufacturing_stages (
            org_id,
            code,
            name,
            order_sequence,
            work_center_id,
            is_active
        )
        VALUES (
            v_org_id,
            v_stage_code,
            v_stage_name,
            v_stage_no,
            v_work_center_id,
            true
        )
        ON CONFLICT (org_id, code) DO NOTHING;
        
        RAISE NOTICE 'Created manufacturing stage: % for org %', v_stage_code, v_org_id;
    END LOOP;
END $$;

-- ===================================================================
-- STEP 2: Add migration flag to stage_costs (if column doesn't exist)
-- ===================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'stage_costs' 
        AND column_name = 'migrated_to_wip_log'
    ) THEN
        ALTER TABLE public.stage_costs 
        ADD COLUMN migrated_to_wip_log BOOLEAN DEFAULT false;
        
        RAISE NOTICE 'Added migrated_to_wip_log column to stage_costs';
    END IF;
END $$;

-- ===================================================================
-- STEP 3: Migrate stage_costs data to stage_wip_log
-- ===================================================================
DO $$
DECLARE
    v_stage_cost RECORD;
    v_stage_id UUID;
    v_period_start DATE;
    v_period_end DATE;
    v_migrated_count INTEGER := 0;
    v_start_time TIMESTAMP;
    v_end_time TIMESTAMP;
    v_duration INTERVAL;
BEGIN
    v_start_time := clock_timestamp();
    RAISE NOTICE 'Migration started at: %', v_start_time;
    -- Loop through all stage_costs that haven't been migrated
    FOR v_stage_cost IN 
        SELECT 
            sc.*,
            mo.org_id
        FROM public.stage_costs sc
        JOIN public.manufacturing_orders mo ON mo.id = sc.mo_id
        WHERE sc.migrated_to_wip_log = false
        AND sc.stage_no IS NOT NULL
        ORDER BY sc.created_at
    LOOP
        -- Find the corresponding manufacturing_stage
        SELECT id INTO v_stage_id
        FROM public.manufacturing_stages
        WHERE org_id = v_stage_cost.org_id
        AND order_sequence = v_stage_cost.stage_no
        LIMIT 1;
        
        -- If stage not found, skip this record
        IF v_stage_id IS NULL THEN
            RAISE WARNING 'Manufacturing stage not found for org_id=%, stage_no=%, skipping...', 
                v_stage_cost.org_id, v_stage_cost.stage_no;
            CONTINUE;
        END IF;
        
        -- Determine period (use month of creation date)
        v_period_start := DATE_TRUNC('month', v_stage_cost.created_at)::DATE;
        v_period_end := (DATE_TRUNC('month', v_stage_cost.created_at) + INTERVAL '1 month - 1 day')::DATE;
        
        -- Insert into stage_wip_log
        INSERT INTO public.stage_wip_log (
            org_id,
            mo_id,
            stage_id,
            period_start,
            period_end,
            
            -- Units (map from stage_costs)
            units_completed,
            units_ending_wip,
            
            -- Costs (map from stage_costs)
            cost_material,
            cost_labor,
            cost_overhead,
            cost_transferred_in,
            
            -- Notes
            notes,
            batch_number,
            
            -- Audit
            created_at,
            created_by
        )
        VALUES (
            v_stage_cost.org_id,
            v_stage_cost.mo_id,
            v_stage_id,
            v_period_start,
            v_period_end,
            
            -- Units
            COALESCE(v_stage_cost.good_qty, 0),
            COALESCE(v_stage_cost.input_qty - COALESCE(v_stage_cost.good_qty, 0), 0),
            
            -- Costs
            COALESCE(v_stage_cost.dm_cost, 0),
            COALESCE(v_stage_cost.dl_cost, 0),
            COALESCE(v_stage_cost.moh_cost, 0),
            COALESCE(v_stage_cost.transferred_in, 0),
            
            -- Notes
            v_stage_cost.notes,
            v_stage_cost.batch_id,
            
            -- Audit
            v_stage_cost.created_at,
            v_stage_cost.created_by
        )
        ON CONFLICT (org_id, mo_id, stage_id, period_start, period_end) 
        DO UPDATE SET
            -- Update if record exists (merge costs)
            cost_material = stage_wip_log.cost_material + EXCLUDED.cost_material,
            cost_labor = stage_wip_log.cost_labor + EXCLUDED.cost_labor,
            cost_overhead = stage_wip_log.cost_overhead + EXCLUDED.cost_overhead,
            cost_transferred_in = stage_wip_log.cost_transferred_in + EXCLUDED.cost_transferred_in,
            units_completed = stage_wip_log.units_completed + EXCLUDED.units_completed,
            units_ending_wip = GREATEST(stage_wip_log.units_ending_wip, EXCLUDED.units_ending_wip),
            updated_at = NOW();
        
        -- Mark as migrated
        UPDATE public.stage_costs
        SET migrated_to_wip_log = true
        WHERE id = v_stage_cost.id;
        
        v_migrated_count := v_migrated_count + 1;
        
        -- Log progress every 100 records
        IF v_migrated_count % 100 = 0 THEN
            RAISE NOTICE 'Migrated % records...', v_migrated_count;
        END IF;
    END LOOP;
    
    v_end_time := clock_timestamp();
    v_duration := v_end_time - v_start_time;
    
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'MIGRATION COMPLETED';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Total records migrated: %', v_migrated_count;
    RAISE NOTICE 'Start time: %', v_start_time;
    RAISE NOTICE 'End time: %', v_end_time;
    RAISE NOTICE 'Duration: %', v_duration;
    RAISE NOTICE '========================================';
END $$;

-- ===================================================================
-- STEP 4: Create view for backward compatibility
-- ===================================================================
CREATE OR REPLACE VIEW public.stage_costs_legacy AS
SELECT 
    sc.id,
    sc.mo_id,
    sc.stage_no,
    sc.wc_id,
    sc.input_qty,
    sc.good_qty,
    sc.scrap_qty,
    sc.rework_qty,
    sc.transferred_in,
    sc.dm_cost,
    sc.dl_cost,
    sc.moh_cost,
    sc.regrind_proc_cost,
    sc.waste_credit,
    sc.total_cost,
    sc.unit_cost,
    sc.mode,
    sc.is_final,
    sc.notes,
    sc.batch_id,
    sc.tenant_id,
    sc.created_at,
    sc.updated_at,
    sc.created_by,
    sc.updated_by,
    -- Add new fields from stage_wip_log
    swl.period_start,
    swl.period_end,
    swl.equivalent_units_material,
    swl.equivalent_units_conversion,
    swl.cost_per_eu_material,
    swl.cost_per_eu_conversion,
    swl.is_closed,
    sc.migrated_to_wip_log
FROM public.stage_costs sc
LEFT JOIN public.manufacturing_stages ms 
    ON ms.org_id = sc.tenant_id 
    AND ms.order_sequence = sc.stage_no
LEFT JOIN public.stage_wip_log swl 
    ON swl.mo_id = sc.mo_id 
    AND swl.stage_id = ms.id
    AND swl.period_start <= sc.created_at::DATE
    AND swl.period_end >= sc.created_at::DATE;

-- Grant permissions on view
GRANT SELECT ON public.stage_costs_legacy TO authenticated;

-- ===================================================================
-- STEP 5: Verification queries
-- ===================================================================

-- Check migration status
DO $$
DECLARE
    v_total_stage_costs INTEGER;
    v_migrated_count INTEGER;
    v_stage_wip_log_count INTEGER;
    v_manufacturing_stages_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_total_stage_costs FROM public.stage_costs;
    SELECT COUNT(*) INTO v_migrated_count FROM public.stage_costs WHERE migrated_to_wip_log = true;
    SELECT COUNT(*) INTO v_stage_wip_log_count FROM public.stage_wip_log;
    SELECT COUNT(*) INTO v_manufacturing_stages_count FROM public.manufacturing_stages;
    
    RAISE NOTICE '========================================';
    RAISE NOTICE 'MIGRATION VERIFICATION';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Total stage_costs records: %', v_total_stage_costs;
    RAISE NOTICE 'Migrated records: %', v_migrated_count;
    RAISE NOTICE 'stage_wip_log records: %', v_stage_wip_log_count;
    RAISE NOTICE 'manufacturing_stages created: %', v_manufacturing_stages_count;
    RAISE NOTICE '========================================';
    
    IF v_migrated_count = v_total_stage_costs THEN
        RAISE NOTICE '✅ All records migrated successfully!';
    ELSE
        RAISE WARNING '⚠️ Some records not migrated: % remaining', (v_total_stage_costs - v_migrated_count);
    END IF;
END $$;

-- ===================================================================
-- MIGRATION COMPLETE
-- ===================================================================
-- Next steps:
-- 1. Verify data integrity using verification queries above
-- 2. Update application code to use new tables
-- 3. Test backward compatibility view
-- 4. Plan deprecation of stage_costs (keep for historical reference)
-- ===================================================================

