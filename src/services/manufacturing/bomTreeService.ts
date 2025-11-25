/**
 * BOM Tree Visualization Service
 * خدمة عرض شجرة BOM متعددة المستويات
 */

import { supabase } from '@/lib/supabase'
import { getEffectiveTenantId } from '@/lib/supabase'

export interface BOMTreeNode {
  id: string
  parent_id: string | null
  item_id: string
  item_code: string
  item_name: string
  level_number: number
  quantity_required: number
  cumulative_quantity: number
  unit_cost: number
  total_cost: number
  is_critical: boolean
  scrap_factor: number
  line_type: 'COMPONENT' | 'PHANTOM' | 'REFERENCE'
  path: string
  has_children: boolean
  children?: BOMTreeNode[]
}

export interface BOMTreeSettings {
  bom_tree_cache_duration_hours: number
  bom_max_levels: number
  bom_auto_calculate_cost: boolean
}

export const bomTreeService = {
  /**
   * بناء شجرة BOM كاملة
   */
  async buildBOMTree(
    bomId: string,
    quantity: number = 1,
    forceRebuild: boolean = false
  ): Promise<BOMTreeNode[]> {
    const orgId = await getEffectiveTenantId()
    if (!orgId) throw new Error('Organization ID not found')

    const { data, error } = await supabase.rpc('build_bom_tree', {
      p_bom_id: bomId,
      p_quantity: quantity,
      p_org_id: orgId,
      p_force_rebuild: forceRebuild
    })

    if (error) throw error

    // بناء هيكل الشجرة
    return this.buildTreeStructure(data || [])
  },

  /**
   * بناء هيكل الشجرة من قائمة مسطحة
   */
  buildTreeStructure(nodes: BOMTreeNode[]): BOMTreeNode[] {
    const nodeMap = new Map<string, BOMTreeNode>()
    const rootNodes: BOMTreeNode[] = []

    // إنشاء map للعقد
    nodes.forEach(node => {
      nodeMap.set(node.id, { ...node, children: [] })
    })

    // بناء الشجرة
    nodes.forEach(node => {
      const treeNode = nodeMap.get(node.id)!
      if (node.parent_id) {
        const parent = nodeMap.get(node.parent_id)
        if (parent) {
          if (!parent.children) parent.children = []
          parent.children.push(treeNode)
        }
      } else {
        rootNodes.push(treeNode)
      }
    })

    return rootNodes
  },

  /**
   * الحصول على مسار عقدة معينة
   */
  getNodePath(nodes: BOMTreeNode[], nodeId: string): BOMTreeNode[] {
    const path: BOMTreeNode[] = []
    const findPath = (nodeList: BOMTreeNode[], targetId: string): boolean => {
      for (const node of nodeList) {
        path.push(node)
        if (node.id === targetId) return true
        if (node.children && findPath(node.children, targetId)) return true
        path.pop()
      }
      return false
    }
    findPath(nodes, nodeId)
    return path
  },

  /**
   * حساب التكلفة الإجمالية للشجرة
   */
  calculateTreeCost(nodes: BOMTreeNode[]): number {
    let total = 0
    const calculate = (nodeList: BOMTreeNode[]) => {
      nodeList.forEach(node => {
        if (node.line_type !== 'REFERENCE') {
          total += node.total_cost
        }
        if (node.children) {
          calculate(node.children)
        }
      })
    }
    calculate(nodes)
    return total
  },

  /**
   * البحث في الشجرة
   */
  searchInTree(
    nodes: BOMTreeNode[],
    searchTerm: string
  ): BOMTreeNode[] {
    const results: BOMTreeNode[] = []
    const search = (nodeList: BOMTreeNode[]) => {
      nodeList.forEach(node => {
        if (
          node.item_code.toLowerCase().includes(searchTerm.toLowerCase()) ||
          node.item_name.toLowerCase().includes(searchTerm.toLowerCase())
        ) {
          results.push(node)
        }
        if (node.children) {
          search(node.children)
        }
      })
    }
    search(nodes)
    return results
  },

  /**
   * الحصول على إعدادات BOM
   */
  async getBOMSettings(): Promise<BOMTreeSettings> {
    const orgId = await getEffectiveTenantId()
    if (!orgId) throw new Error('Organization ID not found')

    const { data, error } = await supabase
      .from('bom_settings')
      .select('setting_key, setting_value, setting_type')
      .eq('org_id', orgId)

    if (error) throw error

    const settings: Partial<BOMTreeSettings> = {}
    data?.forEach(setting => {
      let value: any = setting.setting_value
      if (setting.setting_type === 'number') {
        value = parseFloat(value)
      } else if (setting.setting_type === 'boolean') {
        value = value === 'true'
      } else if (setting.setting_type === 'json') {
        value = JSON.parse(value)
      }
      const key = setting.setting_key as keyof BOMTreeSettings
      if (key in settings || ['bom_tree_cache_duration_hours', 'bom_max_levels', 'bom_auto_calculate_cost'].includes(key)) {
        (settings as any)[key] = value
      }
    })

    return {
      bom_tree_cache_duration_hours: settings.bom_tree_cache_duration_hours || 1,
      bom_max_levels: settings.bom_max_levels || 20,
      bom_auto_calculate_cost: settings.bom_auto_calculate_cost ?? true
    }
  },

  /**
   * تحديث إعدادات BOM
   */
  async updateBOMSettings(
    settings: Partial<BOMTreeSettings>,
    userId?: string
  ): Promise<void> {
    const orgId = await getEffectiveTenantId()
    if (!orgId) throw new Error('Organization ID not found')

    const updates = Object.entries(settings).map(([key, value]) => ({
      org_id: orgId,
      setting_key: key,
      setting_value: String(value),
      setting_type: typeof value === 'number' ? 'number' : 
                   typeof value === 'boolean' ? 'boolean' : 'string',
      updated_by: userId,
      updated_at: new Date().toISOString()
    }))

    for (const update of updates) {
      const { error } = await supabase
        .from('bom_settings')
        .upsert(update, { onConflict: 'org_id,setting_key' })

      if (error) throw error
    }
  },

  /**
   * مسح cache
   */
  async clearBOMCache(bomId?: string): Promise<number> {
    const orgId = await getEffectiveTenantId()
    if (!orgId) throw new Error('Organization ID not found')

    let query = supabase
      .from('bom_tree_cache')
      .delete()
      .eq('org_id', orgId)

    if (bomId) {
      query = query.eq('bom_id', bomId)
    }

    const { data, error } = await query

    if (error) throw error
    return (data && Array.isArray(data) ? data.length : 0) || 0
  }
}

export default bomTreeService

