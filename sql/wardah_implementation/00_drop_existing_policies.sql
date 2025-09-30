-- Wardah ERP - Drop Existing RLS Policies
-- Run this to drop policies that currently exist in the database

-- First, let's try to drop all possible policies (errors will be ignored)
-- Organizations
DROP POLICY IF EXISTS "Users can view their organizations" ON organizations;
DROP POLICY IF EXISTS "Admins can update their organizations" ON organizations;

-- User Organizations
DROP POLICY IF EXISTS "Users can view org memberships" ON user_organizations;
DROP POLICY IF EXISTS "Admins can manage org memberships" ON user_organizations;

-- GL Accounts
DROP POLICY IF EXISTS "Users can view org GL accounts" ON gl_accounts;
DROP POLICY IF EXISTS "Managers can insert GL accounts" ON gl_accounts;
DROP POLICY IF EXISTS "Managers can update GL accounts" ON gl_accounts;
DROP POLICY IF EXISTS "Admins can delete GL accounts" ON gl_accounts;

-- GL Mappings
DROP POLICY IF EXISTS "Users can view org GL mappings" ON gl_mappings;
DROP POLICY IF EXISTS "Managers can manage GL mappings" ON gl_mappings;

-- Manufacturing tables
DROP POLICY IF EXISTS "Users can view org UOMs" ON uoms;
DROP POLICY IF EXISTS "Managers can manage UOMs" ON uoms;
DROP POLICY IF EXISTS "Users can view org products" ON products;
DROP POLICY IF EXISTS "Users can insert products" ON products;
DROP POLICY IF EXISTS "Users can update products" ON products;
DROP POLICY IF EXISTS "Managers can delete products" ON products;
DROP POLICY IF EXISTS "Users can view org warehouses" ON warehouses;
DROP POLICY IF EXISTS "Managers can manage warehouses" ON warehouses;
DROP POLICY IF EXISTS "Users can view locations" ON locations;
DROP POLICY IF EXISTS "Managers can manage locations" ON locations;
DROP POLICY IF EXISTS "Users can view org locations" ON locations;
DROP POLICY IF EXISTS "Users can view BOM headers" ON bom_headers;
DROP POLICY IF EXISTS "Managers can manage BOM headers" ON bom_headers;
DROP POLICY IF EXISTS "Users can view BOM lines" ON bom_lines;
DROP POLICY IF EXISTS "Managers can manage BOM lines" ON bom_lines;
DROP POLICY IF EXISTS "Users can view manufacturing orders" ON manufacturing_orders;
DROP POLICY IF EXISTS "Managers can manage manufacturing orders" ON manufacturing_orders;
DROP POLICY IF EXISTS "Users can view work centers" ON work_centers;
DROP POLICY IF EXISTS "Managers can manage work centers" ON work_centers;
DROP POLICY IF EXISTS "Users can view labor entries" ON labor_entries;
DROP POLICY IF EXISTS "Managers can manage labor entries" ON labor_entries;
DROP POLICY IF EXISTS "Users can view overhead rates" ON overhead_rates;
DROP POLICY IF EXISTS "Managers can manage overhead rates" ON overhead_rates;
DROP POLICY IF EXISTS "Users can view overhead allocations" ON overhead_allocations;
DROP POLICY IF EXISTS "Managers can manage overhead allocations" ON overhead_allocations;

-- Inventory tables
DROP POLICY IF EXISTS "Users can view stock quants" ON stock_quants;
DROP POLICY IF EXISTS "Managers can manage stock quants" ON stock_quants;
DROP POLICY IF EXISTS "Users can view stock moves" ON stock_moves;
DROP POLICY IF EXISTS "Managers can manage stock moves" ON stock_moves;
DROP POLICY IF EXISTS "Users can view cost settings" ON cost_settings;
DROP POLICY IF EXISTS "Managers can manage cost settings" ON cost_settings;

-- Sales & Purchase tables
DROP POLICY IF EXISTS "Users can view vendors" ON vendors;
DROP POLICY IF EXISTS "Managers can manage vendors" ON vendors;
DROP POLICY IF EXISTS "Users can view customers" ON customers;
DROP POLICY IF EXISTS "Managers can manage customers" ON customers;
DROP POLICY IF EXISTS "Users can view purchase orders" ON purchase_orders;
DROP POLICY IF EXISTS "Managers can manage purchase orders" ON purchase_orders;
DROP POLICY IF EXISTS "Users can view purchase lines" ON purchase_lines;
DROP POLICY IF EXISTS "Managers can manage purchase lines" ON purchase_lines;
DROP POLICY IF EXISTS "Users can view GRNs" ON grns;
DROP POLICY IF EXISTS "Managers can manage GRNs" ON grns;
DROP POLICY IF EXISTS "Users can view sales orders" ON sales_orders;
DROP POLICY IF EXISTS "Managers can manage sales orders" ON sales_orders;
DROP POLICY IF EXISTS "Users can view sales lines" ON sales_lines;
DROP POLICY IF EXISTS "Managers can manage sales lines" ON sales_lines;

-- Success message
SELECT 'Attempted to drop existing policies' as result;