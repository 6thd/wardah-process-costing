from pathlib import Path


path = Path('src/features/inventory/index.tsx')
text = path.read_text(encoding='utf-8')


def replace_once(old: str, new: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'expected exactly one match, found {count}: {old[:120]!r}')
    text = text.replace(old, new, 1)


replace_once(
    "  const loadProducts = async () => {\n    try {\n      const data = await itemsService.getAll()\n      setProducts(data || [])\n    } catch (error) {\n      console.error('Error loading products:', error)\n    }\n  }",
    "  const loadProducts = async () => {\n    if (!currentOrgId) {\n      setProducts([])\n      return\n    }\n\n    try {\n      const supabase = getSupabase()\n      const { data, error } = await supabase\n        .from('products')\n        .select('*')\n        .eq('org_id', currentOrgId)\n        .order('name')\n\n      if (error) throw error\n      setProducts(data || [])\n    } catch (error) {\n      console.error('Error loading products:', error)\n      setProducts([])\n    }\n  }",
)

replace_once(
    "  const loadWarehouses = async () => {\n    try {\n      setLoadingWarehouses(true)\n      const supabase = getSupabase()\n      const { data, error } = await supabase\n        .from('warehouses')\n        .select('*')\n        .eq('is_active', true)\n        .order('name')\n\n      if (error) throw error\n      \n      setWarehouses(data || [])\n      \n      // Auto-select first warehouse\n      if (data && data.length > 0 && !newAdjustment.warehouse_id) {\n        setNewAdjustment(prev => ({\n          ...prev,\n          warehouse_id: data[0].id\n        }))\n      }",
    "  const loadWarehouses = async () => {\n    if (!currentOrgId) {\n      setWarehouses([])\n      setLoadingWarehouses(false)\n      return\n    }\n\n    try {\n      setLoadingWarehouses(true)\n      const supabase = getSupabase()\n      const { data, error } = await supabase\n        .from('warehouses')\n        .select('*')\n        .eq('org_id', currentOrgId)\n        .eq('is_active', true)\n        .order('name')\n\n      if (error) throw error\n\n      const organizationWarehouses = data || []\n      setWarehouses(organizationWarehouses)\n\n      // Never retain a warehouse selected under a previously active organization.\n      setNewAdjustment(prev => ({\n        ...prev,\n        warehouse_id: organizationWarehouses.some(warehouse => warehouse.id === prev.warehouse_id)\n          ? prev.warehouse_id\n          : (organizationWarehouses[0]?.id || '')\n      }))",
)

warehouse_lookup_old = "            .from('warehouses')\n            .select('inventory_account_id')\n            .eq('id', adjustment.warehouse_id)\n            .single()"
warehouse_lookup_new = "            .from('warehouses')\n            .select('inventory_account_id')\n            .eq('id', adjustment.warehouse_id)\n            .eq('org_id', currentOrgId)\n            .single()"
if text.count(warehouse_lookup_old) != 2:
    raise SystemExit(f'expected two warehouse account lookups, found {text.count(warehouse_lookup_old)}')
text = text.replace(warehouse_lookup_old, warehouse_lookup_new)

replace_once(
    "        .update({\n          status: 'SUBMITTED',\n          submitted_at: new Date().toISOString(),\n          submitted_by: user.id\n        })\n        .eq('id', adjustmentId)",
    "        .update({\n          status: 'SUBMITTED',\n          submitted_at: new Date().toISOString(),\n          submitted_by: user.id\n        })\n        .eq('id', adjustmentId)\n        .eq('organization_id', currentOrgId)",
)

path.write_text(text, encoding='utf-8')
