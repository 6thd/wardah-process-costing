-- ===================================================================
-- NOTIFICATION TABLES
-- Tables for handling user notifications in the accounting system
-- ===================================================================

-- ===================================================================
-- NOTIFICATIONS TABLE
-- Stores in-app notifications for users
-- ===================================================================
CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('INFO', 'WARNING', 'ERROR', 'SUCCESS')),
    read BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now(),
    tenant_id UUID NOT NULL
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_notifications_tenant_user ON public.notifications(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_tenant_user_read ON public.notifications(tenant_id, user_id, read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON public.notifications(tenant_id, created_at DESC);

-- ===================================================================
-- NOTIFICATION PREFERENCES TABLE
-- Stores user preferences for notification delivery
-- ===================================================================
CREATE TABLE IF NOT EXISTS public.notification_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    email BOOLEAN DEFAULT true,
    in_app BOOLEAN DEFAULT true,
    sms BOOLEAN DEFAULT false,
    push BOOLEAN DEFAULT false,
    variance_threshold NUMERIC(18,4) DEFAULT 1000,
    severity_threshold TEXT DEFAULT 'MEDIUM' CHECK (severity_threshold IN ('LOW', 'MEDIUM', 'HIGH')),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    tenant_id UUID NOT NULL,
    UNIQUE(tenant_id, user_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_notification_preferences_tenant_user ON public.notification_preferences(tenant_id, user_id);

-- ===================================================================
-- TRIGGERS FOR AUDIT FIELDS
-- ===================================================================
CREATE OR REPLACE FUNCTION update_notification_preferences_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply triggers
CREATE TRIGGER update_notification_preferences_updated_at_trigger 
    BEFORE UPDATE ON public.notification_preferences
    FOR EACH ROW EXECUTE FUNCTION update_notification_preferences_updated_at();

-- ===================================================================
-- RLS POLICIES
-- ===================================================================
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

-- Policies for notifications
CREATE POLICY notifications_tenant_isolation ON public.notifications
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

-- Policies for notification preferences
CREATE POLICY notification_preferences_tenant_isolation ON public.notification_preferences
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

-- ===================================================================
-- SAMPLE DATA
-- ===================================================================
-- Note: This would typically be populated by the application based on user actions
-- For demonstration purposes, we'll insert a sample preference record

-- Sample notification preference (would be created when user sets preferences)
-- INSERT INTO public.notification_preferences (
--     user_id, 
--     email, 
--     in_app, 
--     sms, 
--     push, 
--     variance_threshold, 
--     severity_threshold, 
--     tenant_id
-- ) VALUES (
--     '00000000-0000-0000-0000-000000000000', -- Sample user ID
--     true,  -- email
--     true,  -- in_app
--     false, -- sms
--     false, -- push
--     1000,  -- variance_threshold
--     'MEDIUM', -- severity_threshold
--     '00000000-0000-0000-0000-000000000001'  -- Sample tenant ID
-- );

-- Sample notification (would be created by the system when events occur)
-- INSERT INTO public.notifications (
--     user_id, 
--     title, 
--     message, 
--     type, 
--     read, 
--     tenant_id
-- ) VALUES (
--     '00000000-0000-0000-0000-000000000000', -- Sample user ID
--     'Variance Alert', 
--     'High variance detected in MO MO-2023-001 Stage 20. Total variance: 2500.00 (12.50%). Severity: HIGH', 
--     'ERROR', 
--     false, 
--     '00000000-0000-0000-0000-000000000001'  -- Sample tenant ID
-- );