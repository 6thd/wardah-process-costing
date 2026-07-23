from pathlib import Path

path = Path('src/features/inventory/index.tsx')
text = path.read_text(encoding='utf-8')


def replace_once(old: str, new: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'expected exactly one match, found {count}: {old[:100]!r}')
    text = text.replace(old, new, 1)


replace_once(
    "import { useProductUomStatus } from '@/hooks/use-product-uom-status'\n",
    "import { useProductUomStatus } from '@/hooks/use-product-uom-status'\n"
    "import { useAuth } from '@/contexts/AuthContext'\n",
)

replace_once(
    "function StockAdjustments() {\n  const { t } = useTranslation()\n  const productUomStatus = useProductUomStatus()",
    "function StockAdjustments() {\n  const { t } = useTranslation()\n  const { currentOrgId } = useAuth()\n  const productUomStatus = useProductUomStatus()",
)

replace_once(
    "  useEffect(() => {\n    loadAdjustments()\n    loadProducts()\n    loadWarehouses()\n    loadGLAccounts()\n  }, [])",
    "  useEffect(() => {\n    if (!currentOrgId) {\n      setAdjustments([])\n      setProducts([])\n      setWarehouses([])\n      setGLAccounts([])\n      setLoading(false)\n      setLoadingWarehouses(false)\n      setLoadingAccounts(false)\n      return\n    }\n    loadAdjustments()\n    loadProducts()\n    loadWarehouses()\n    loadGLAccounts()\n  }, [currentOrgId])",
)

replace_once(
    "      console.log('✅ User:', user.id)\n\n      const { data: userOrgs, error: orgError } = await supabase\n        .from('user_organizations')\n        .select('org_id')\n        .eq('user_id', user.id)\n        .single()\n\n      if (orgError || !userOrgs) {\n        console.log('❌ No organization found:', orgError)\n        setAdjustments([])\n        setLoading(false)\n        return\n      }\n\n      console.log('✅ Organization:', userOrgs.org_id)\n\n      let query = supabase\n        .from('stock_adjustments')\n        .select('*')\n        .eq('organization_id', userOrgs.org_id)",
    "      console.log('✅ User:', user.id)\n\n      if (!currentOrgId) {\n        setAdjustments([])\n        setLoading(false)\n        return\n      }\n\n      console.log('✅ Organization:', currentOrgId)\n\n      let query = supabase\n        .from('stock_adjustments')\n        .select('*')\n        .eq('organization_id', currentOrgId)",
)

replace_once(
    "      const { data: userOrgs } = await supabase\n        .from('user_organizations')\n        .select('org_id')\n        .eq('user_id', user.id)\n        .single()\n\n      if (!userOrgs) {\n        setGLAccounts([])\n        setLoadingAccounts(false)\n        return\n      }\n\n      // Load GL Accounts (expense and asset accounts)\n      const { data, error } = await supabase\n        .from('gl_accounts')\n        .select('*')\n        .eq('org_id', userOrgs.org_id)",
    "      if (!currentOrgId) {\n        setGLAccounts([])\n        setLoadingAccounts(false)\n        return\n      }\n\n      // Load GL Accounts for the organization selected in AuthContext.\n      const { data, error } = await supabase\n        .from('gl_accounts')\n        .select('*')\n        .eq('org_id', currentOrgId)",
)

replace_once(
    "      const { data: userOrg } = await supabase\n        .from('user_organizations')\n        .select('org_id')\n        .eq('user_id', user.id)\n        .single()\n\n      if (!userOrg) {\n        toast.error('لم يتم العثور على المؤسسة')\n        return\n      }",
    "      if (!currentOrgId) {\n        toast.error('لم يتم تحديد المؤسسة النشطة')\n        return\n      }",
)

text = text.replace("organization_id: userOrg.org_id", "organization_id: currentOrgId")

replace_once(
    "          .eq('id', selectedAdjustment.id)\n          .select()",
    "          .eq('id', selectedAdjustment.id)\n          .eq('organization_id', currentOrgId)\n          .select()",
)
replace_once(
    "          .eq('adjustment_id', selectedAdjustment.id)\n\n        if (deleteError)",
    "          .eq('adjustment_id', selectedAdjustment.id)\n          .eq('organization_id', currentOrgId)\n\n        if (deleteError)",
)

replace_once(
    "      // Get user's organization\n      const { data: userOrg } = await supabase\n        .from('user_organizations')\n        .select('org_id')\n        .eq('user_id', user.id)\n        .single()\n\n      if (!userOrg) {\n        toast.error('لم يتم العثور على المؤسسة')\n        return\n      }",
    "      if (!currentOrgId) {\n        toast.error('لم يتم تحديد المؤسسة النشطة')\n        return\n      }",
)

replace_once(
    "        .eq('id', adjustmentId)\n        .single()",
    "        .eq('id', adjustmentId)\n        .eq('organization_id', currentOrgId)\n        .single()",
)
replace_once(
    "        .eq('adjustment_id', adjustmentId)\n\n      if (itemsError",
    "        .eq('adjustment_id', adjustmentId)\n        .eq('organization_id', currentOrgId)\n\n      if (itemsError",
)
text = text.replace("org_id: userOrg.org_id", "org_id: currentOrgId")

if "userOrg.org_id" in text or "userOrgs.org_id" in text:
    raise SystemExit('stale derived organization reference remains')

path.write_text(text, encoding='utf-8')
