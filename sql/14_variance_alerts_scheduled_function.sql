-- ===================================================================
-- SCHEDULED FUNCTION FOR VARIANCE ALERTS
-- Periodic check for cost variances exceeding thresholds
-- ===================================================================

-- ===================================================================
-- VARIANCE ALERTS SCHEDULED FUNCTION
-- This function runs periodically to check for significant variances
-- and create alerts in the variance_analysis table
-- ===================================================================
CREATE OR REPLACE FUNCTION public.check_variance_alerts()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tenant RECORD;
  v_mo RECORD;
  v_stage RECORD;
  v_standard_material NUMERIC;
  v_standard_labor NUMERIC;
  v_standard_overhead NUMERIC;
  v_actual_material NUMERIC;
  v_actual_labor NUMERIC;
  v_actual_overhead NUMERIC;
  v_material_variance_pct NUMERIC;
  v_labor_variance_pct NUMERIC;
  v_overhead_variance_pct NUMERIC;
  v_total_variance_pct NUMERIC;
  v_severity TEXT;
  v_alert_exists BOOLEAN;
BEGIN
  -- Loop through all tenants
  FOR v_tenant IN
    SELECT DISTINCT tenant_id FROM public.manufacturing_orders WHERE tenant_id IS NOT NULL
  LOOP
    -- Loop through manufacturing orders for this tenant
    FOR v_mo IN
      SELECT id, order_number FROM public.manufacturing_orders 
      WHERE tenant_id = v_tenant.tenant_id 
        AND status IN ('in_progress', 'completed')
        AND updated_at >= CURRENT_DATE - INTERVAL '30 days' -- Only check recent orders
    LOOP
      -- Loop through stages for this manufacturing order
      FOR v_stage IN
        SELECT DISTINCT stage_no FROM public.stage_costs 
        WHERE tenant_id = v_tenant.tenant_id 
          AND mo_id = v_mo.id
      LOOP
        -- Get standard costs (precosted values)
        SELECT 
          COALESCE(SUM(dm_cost), 0),
          COALESCE(SUM(dl_cost), 0),
          COALESCE(SUM(moh_cost), 0)
        INTO v_standard_material, v_standard_labor, v_standard_overhead
        FROM public.stage_costs
        WHERE tenant_id = v_tenant.tenant_id 
          AND mo_id = v_mo.id 
          AND stage_no = v_stage.stage_no
          AND mode = 'precosted';
        
        -- Get actual costs
        SELECT 
          COALESCE(SUM(dm_cost), 0),
          COALESCE(SUM(dl_cost), 0),
          COALESCE(SUM(moh_cost), 0)
        INTO v_actual_material, v_actual_labor, v_actual_overhead
        FROM public.stage_costs
        WHERE tenant_id = v_tenant.tenant_id 
          AND mo_id = v_mo.id 
          AND stage_no = v_stage.stage_no
          AND mode = 'actual';
        
        -- Calculate variance percentages
        v_material_variance_pct := CASE 
          WHEN v_standard_material > 0 THEN 
            ABS((v_actual_material - v_standard_material) / v_standard_material * 100)
          ELSE 0 
        END;
        
        v_labor_variance_pct := CASE 
          WHEN v_standard_labor > 0 THEN 
            ABS((v_actual_labor - v_standard_labor) / v_standard_labor * 100)
          ELSE 0 
        END;
        
        v_overhead_variance_pct := CASE 
          WHEN v_standard_overhead > 0 THEN 
            ABS((v_actual_overhead - v_standard_overhead) / v_standard_overhead * 100)
          ELSE 0 
        END;
        
        -- Calculate total variance percentage
        v_total_variance_pct := v_material_variance_pct + v_labor_variance_pct + v_overhead_variance_pct;
        
        -- Determine severity
        IF GREATEST(v_material_variance_pct, v_labor_variance_pct, v_overhead_variance_pct) > 10 THEN
          v_severity := 'HIGH';
        ELSIF GREATEST(v_material_variance_pct, v_labor_variance_pct, v_overhead_variance_pct) > 5 THEN
          v_severity := 'MEDIUM';
        ELSE
          v_severity := 'LOW';
        END IF;
        
        -- Only create alert if severity is MEDIUM or HIGH
        IF v_severity IN ('MEDIUM', 'HIGH') THEN
          -- Check if alert already exists for today
          SELECT EXISTS (
            SELECT 1 FROM public.variance_analysis 
            WHERE tenant_id = v_tenant.tenant_id 
              AND mo_id = v_mo.id 
              AND stage_no = v_stage.stage_no
              AND variance_date = CURRENT_DATE
          ) INTO v_alert_exists;
          
          IF NOT v_alert_exists THEN
            -- Insert variance analysis record
            INSERT INTO public.variance_analysis (
              tenant_id, mo_id, stage_no, variance_date,
              standard_material_cost, standard_labor_cost, standard_overhead_cost,
              actual_material_cost, actual_labor_cost, actual_overhead_cost,
              created_by
            ) VALUES (
              v_tenant.tenant_id, v_mo.id, v_stage.stage_no, CURRENT_DATE,
              v_standard_material, v_standard_labor, v_standard_overhead,
              v_actual_material, v_actual_labor, v_actual_overhead,
              'system' -- System-generated alert
            );
            
            -- Log the alert creation
            RAISE NOTICE 'Variance alert created for MO %, Stage %, Severity: %', 
              v_mo.order_number, v_stage.stage_no, v_severity;
          END IF;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
END $$;

-- ===================================================================
-- FUNCTION TO SEND ALERT NOTIFICATIONS
-- This function sends email notifications for variance alerts
-- ===================================================================
CREATE OR REPLACE FUNCTION public.send_variance_alert_notifications()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_alert RECORD;
  v_tenant_admin_email TEXT;
  v_mo_number TEXT;
  v_item_name TEXT;
  v_subject TEXT;
  v_body TEXT;
BEGIN
  -- Loop through high severity alerts from today that haven't been notified
  FOR v_alert IN
    SELECT 
      va.*, 
      mo.order_number,
      i.name as item_name
    FROM public.variance_analysis va
    JOIN public.manufacturing_orders mo ON mo.id = va.mo_id
    JOIN public.items i ON i.id = mo.item_id
    WHERE va.variance_date = CURRENT_DATE
      AND va.variance_severity IN ('HIGH', 'MEDIUM')
      AND NOT EXISTS (
        SELECT 1 FROM public.alert_notifications an 
        WHERE an.alert_id = va.id AND an.notification_type = 'email'
      )
  LOOP
    -- Get tenant admin email (simplified - in practice you'd have a more robust method)
    SELECT email INTO v_tenant_admin_email
    FROM public.users 
    WHERE tenant_id = v_alert.tenant_id 
      AND role = 'admin'
    LIMIT 1;
    
    -- If we have an admin email, send notification
    IF v_tenant_admin_email IS NOT NULL THEN
      -- Prepare email content
      v_subject := format('Variance Alert: MO %s - Stage %s', v_alert.order_number, v_alert.stage_no);
      
      v_body := format(
        'A significant cost variance has been detected:\n\n' ||
        'Manufacturing Order: %s\n' ||
        'Item: %s\n' ||
        'Stage: %s\n' ||
        'Date: %s\n' ||
        'Severity: %s\n\n' ||
        'Variances:\n' ||
        '- Material: %s%%\n' ||
        '- Labor: %s%%\n' ||
        '- Overhead: %s%%\n' ||
        '- Total: %s%%\n\n' ||
        'Please review this variance and take appropriate action.',
        v_alert.order_number,
        v_alert.item_name,
        v_alert.stage_no,
        v_alert.variance_date,
        v_alert.variance_severity,
        ROUND(v_alert.material_variance_percentage, 2),
        ROUND(v_alert.labor_variance_percentage, 2),
        ROUND(v_alert.overhead_variance_percentage, 2),
        ROUND(v_alert.material_variance_percentage + v_alert.labor_variance_percentage + v_alert.overhead_variance_percentage, 2)
      );
      
      -- In a real implementation, you would integrate with an email service here
      -- For now, we'll just log that we would send an email
      RAISE NOTICE 'Would send email to %: %', v_tenant_admin_email, v_subject;
      
      -- Record that we sent the notification
      INSERT INTO public.alert_notifications (
        alert_id, notification_type, recipient, subject, status
      ) VALUES (
        v_alert.id, 'email', v_tenant_admin_email, v_subject, 'sent'
      );
    END IF;
  END LOOP;
END $$;

-- ===================================================================
-- ALERT NOTIFICATIONS TABLE
-- Track which alerts have been notified and how
-- ===================================================================
CREATE TABLE IF NOT EXISTS public.alert_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id UUID NOT NULL REFERENCES public.variance_analysis(id),
  notification_type TEXT NOT NULL, -- 'email', 'slack', 'webhook', etc.
  recipient TEXT NOT NULL,
  subject TEXT,
  message TEXT,
  sent_at TIMESTAMPTZ DEFAULT now(),
  status TEXT DEFAULT 'sent', -- 'sent', 'failed', 'pending'
  tenant_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_alert_notifications_alert ON public.alert_notifications(alert_id);
CREATE INDEX idx_alert_notifications_tenant ON public.alert_notifications(tenant_id);
CREATE INDEX idx_alert_notifications_type ON public.alert_notifications(notification_type);

-- Enable RLS
ALTER TABLE public.alert_notifications ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS tenant_select_alert_notifications ON public.alert_notifications;
CREATE POLICY tenant_select_alert_notifications ON public.alert_notifications
  FOR SELECT USING (tenant_id = get_current_tenant_id());

DROP POLICY IF EXISTS tenant_insert_alert_notifications ON public.alert_notifications;
CREATE POLICY tenant_insert_alert_notifications ON public.alert_notifications
  FOR INSERT WITH CHECK (tenant_id = get_current_tenant_id());

-- Audit trail
CREATE TRIGGER audit_alert_notifications AFTER INSERT OR UPDATE OR DELETE ON public.alert_notifications
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

-- ===================================================================
-- SCHEDULED JOBS SETUP
-- These would be set up in Supabase to run periodically
-- ===================================================================

/*
-- Example of how to set up scheduled jobs in Supabase:

-- Check variance alerts every hour
-- SELECT cron.schedule(
--   'check-variance-alerts',
--   '0 * * * *', -- Every hour
--   $$SELECT public.check_variance_alerts()$$
-- );

-- Send variance alert notifications every day at 9 AM
-- SELECT cron.schedule(
--   'send-variance-alerts',
--   '0 9 * * *', -- Daily at 9 AM
--   $$SELECT public.send_variance_alert_notifications()$$
-- );
*/

-- ===================================================================
-- GRANT PERMISSIONS
-- ===================================================================
GRANT EXECUTE ON FUNCTION public.check_variance_alerts() TO service_role;
GRANT EXECUTE ON FUNCTION public.send_variance_alert_notifications() TO service_role;

-- ===================================================================
-- COMMENTS FOR DOCUMENTATION
-- ===================================================================
COMMENT ON FUNCTION public.check_variance_alerts IS 'Scheduled function to check for cost variances and create alerts';
COMMENT ON FUNCTION public.send_variance_alert_notifications IS 'Scheduled function to send notifications for variance alerts';
COMMENT ON TABLE public.alert_notifications IS 'Track alert notifications sent to users';

-- ===================================================================
-- SAMPLE DATA FOR TESTING
-- ===================================================================
/*
-- Insert sample data for testing
INSERT INTO public.alert_notifications (
  alert_id, notification_type, recipient, subject, status, tenant_id
) VALUES (
  '00000000-0000-0000-0000-000000000000', -- Replace with actual alert ID
  'email',
  'admin@example.com',
  'Test Variance Alert',
  'sent',
  '00000000-0000-0000-0000-000000000000' -- Replace with actual tenant ID
);
*/