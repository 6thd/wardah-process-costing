# Security Fixes for Supabase Database

This document explains the security issues found in the Supabase CSV log files and how the `FIX_SECURITY_ISSUES.sql` script addresses them.

## Issues Found

### 1. RLS Disabled on Public Tables
- **Tables affected**: `gl_accounts`, `gl_accounts_backup`
- **Risk**: All data in these tables is accessible without restrictions
- **Fix**: Enabled RLS and created basic policies allowing authenticated users full access (with conflict prevention)

### 2. Function Search Path Issues
- **Functions affected**: `auth_org_id`, `import_gl_mappings`, `has_any_role`, `has_org_role`, `import_chart_of_accounts`
- **Risk**: Mutable search paths can lead to security vulnerabilities
- **Fix**: Set fixed search paths for each function

### 3. RLS Enabled but No Policies
- **Tables affected**: 20+ tables including `bom_headers`, `customers`, `manufacturing_orders`, etc.
- **Risk**: RLS is enabled but without policies, effectively blocks all access
- **Fix**: Created basic policies allowing authenticated users full access to each table

### 4. Auth Security Settings
- **Issues**: Leaked password protection disabled, insufficient MFA options
- **Fix**: Instructions provided to enable in Supabase Dashboard

### 5. Extension in Public Schema
- **Extension**: `ltree` installed in public schema
- **Risk**: Potential security and organization issues
- **Fix**: Instructions provided to move to separate schema

## Implementation Instructions

1. Run the `FIX_SECURITY_ISSUES.sql` script in your Supabase SQL editor
2. Review and adjust the RLS policies based on your specific business requirements
3. Enable auth security features in the Supabase Dashboard:
   - Go to Authentication → Settings
   - Enable "Password strength and leaked password protection"
   - Enable additional MFA options
4. Consider moving the `ltree` extension to a separate schema if needed

## Important Notes

- The RLS policies in this script provide basic access control allowing authenticated users full access
- You should review and customize these policies based on your specific business requirements
- Some fixes (auth settings, extension schema) require action in the Supabase Dashboard
- Test thoroughly in a development environment before applying to production