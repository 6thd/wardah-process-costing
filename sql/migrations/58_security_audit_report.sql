-- =====================================
-- Security Audit Report - RLS Policies Verification
-- =====================================
-- This script verifies that all tables have RLS enabled and proper policies
-- Run this script to generate a comprehensive security audit report

DO $$
DECLARE
    table_record RECORD;
    policy_count INTEGER;
    rls_enabled BOOLEAN;
    missing_policies TEXT[] := ARRAY[]::TEXT[];
    tables_without_rls TEXT[] := ARRAY[]::TEXT[];
    report_text TEXT := '';
BEGIN
    report_text := '=== SECURITY AUDIT REPORT ===' || E'\n';
    report_text := report_text || 'Generated: ' || NOW()::TEXT || E'\n\n';
    
    -- Check all user tables (exclude system tables)
    FOR table_record IN 
        SELECT 
            schemaname,
            tablename
        FROM pg_tables
        WHERE schemaname = 'public'
        AND tablename NOT LIKE 'pg_%'
        AND tablename NOT LIKE '_realtime%'
        ORDER BY tablename
    LOOP
        -- Check if RLS is enabled
        SELECT relrowsecurity INTO rls_enabled
        FROM pg_class
        WHERE relname = table_record.tablename
        AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
        
        -- Count policies
        SELECT COUNT(*) INTO policy_count
        FROM pg_policies
        WHERE schemaname = 'public'
        AND tablename = table_record.tablename;
        
        -- Build report
        report_text := report_text || 'Table: ' || table_record.tablename || E'\n';
        report_text := report_text || '  RLS Enabled: ' || COALESCE(rls_enabled::TEXT, 'UNKNOWN') || E'\n';
        report_text := report_text || '  Policies Count: ' || policy_count::TEXT || E'\n';
        
        -- Check for issues
        IF NOT rls_enabled THEN
            tables_without_rls := array_append(tables_without_rls, table_record.tablename);
            report_text := report_text || '  ⚠️  WARNING: RLS is NOT enabled!' || E'\n';
        END IF;
        
        IF policy_count = 0 AND rls_enabled THEN
            missing_policies := array_append(missing_policies, table_record.tablename);
            report_text := report_text || '  ⚠️  WARNING: RLS enabled but NO policies found!' || E'\n';
        END IF;
        
        -- Check for tenant isolation policies
        IF policy_count > 0 THEN
            IF NOT EXISTS (
                SELECT 1 FROM pg_policies
                WHERE schemaname = 'public'
                AND tablename = table_record.tablename
                AND (policyname LIKE '%tenant%' OR policyname LIKE '%org%' OR policyname LIKE '%isolation%')
            ) THEN
                report_text := report_text || '  ⚠️  WARNING: No tenant isolation policy detected!' || E'\n';
            END IF;
        END IF;
        
        report_text := report_text || E'\n';
    END LOOP;
    
    -- Summary
    report_text := report_text || E'\n=== SUMMARY ===' || E'\n';
    report_text := report_text || 'Tables without RLS: ' || array_length(tables_without_rls, 1)::TEXT || E'\n';
    report_text := report_text || 'Tables with missing policies: ' || array_length(missing_policies, 1)::TEXT || E'\n';
    
    IF array_length(tables_without_rls, 1) > 0 THEN
        report_text := report_text || E'\n⚠️  CRITICAL: Tables without RLS:' || E'\n';
        FOREACH table_record.tablename IN ARRAY tables_without_rls
        LOOP
            report_text := report_text || '  - ' || table_record.tablename || E'\n';
        END LOOP;
    END IF;
    
    IF array_length(missing_policies, 1) > 0 THEN
        report_text := report_text || E'\n⚠️  CRITICAL: Tables with RLS but no policies:' || E'\n';
        FOREACH table_record.tablename IN ARRAY missing_policies
        LOOP
            report_text := report_text || '  - ' || table_record.tablename || E'\n';
        END LOOP;
    END IF;
    
    -- Output report
    RAISE NOTICE '%', report_text;
    
    -- Create audit table if it doesn't exist
    CREATE TABLE IF NOT EXISTS security_audit_reports (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        report_date TIMESTAMPTZ DEFAULT NOW(),
        tables_without_rls TEXT[],
        tables_with_missing_policies TEXT[],
        report_text TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
    );
    
    -- Insert report
    INSERT INTO security_audit_reports (
        tables_without_rls,
        tables_with_missing_policies,
        report_text
    ) VALUES (
        tables_without_rls,
        missing_policies,
        report_text
    );
    
    RAISE NOTICE 'Report saved to security_audit_reports table';
    
END $$;

-- Query to view latest audit report
-- SELECT * FROM security_audit_reports ORDER BY report_date DESC LIMIT 1;

