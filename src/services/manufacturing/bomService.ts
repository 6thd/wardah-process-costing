/**
 * BOM Service - خدمة إدارة قوائم المواد
 * Bill of Materials Management Service
 */

import { supabase } from '@/lib/supabase'

export interface BOMHeader {
  id?: string
  bom_number: string
  item_id: string
  item_code?: string
  item_name?: string
  description?: string
  bom_version: number
  is_active: boolean
  effective_date: string
  unit_cost: number
  approved_by?: string
  approved_at?: string
  status: 'DRAFT' | 'APPROVED' | 'OBSOLETE'
  notes?: string
  org_id: string
  created_at?: string
  updated_at?: string
}

export interface BOMLine {
  id?: string
  bom_id: string
  line_number: number
  item_id: string
  item_code?: string
  item_name?: string
  quantity: number
  unit_of_measure: string
  line_type: 'COMPONENT' | 'PHANTOM' | 'REFERENCE'
  scrap_factor: number
  is_critical: boolean
  yield_percentage: number
  operation_sequence?: number
  notes?: string
  effective_from: string
  effective_to?: string
  org_id: string
}

export interface BOMVersion {
  id?: string
  bom_id: string
  version_number: number
  change_description?: string
  changed_by?: string
  changed_at?: string
  org_id: string
}

export interface BOMExplosionItem {
  level_number: number
  item_id: string
  item_code: string
  item_name: string
  quantity_required: number
  unit_of_measure: string
  is_critical: boolean
  scrap_factor: number
  line_type: string
}

export interface WhereUsedItem {
  parent_bom_id: string
  parent_item_code: string
  parent_item_name: string
  quantity_per: number
  bom_status: string
  is_active: boolean
}

/**
 * خدمة BOM
 */
export const bomService = {
  /**
   * الحصول على جميع قوائم المواد
   */
  async getAllBOMs(orgId: string): Promise<BOMHeader[]> {
    const { data, error } = await supabase
      .from('bom_headers')
      .select(`
        *,
        item:items!bom_headers_item_id_fkey(
          item_code,
          item_name
        )
      `)
      .eq('org_id', orgId)
      .order('bom_number', { ascending: false })

    if (error) throw error
    
    return data.map(bom => ({
      ...bom,
      item_code: bom.item?.item_code,
      item_name: bom.item?.item_name
    }))
  },

  /**
   * الحصول على BOM واحد بالتفاصيل
   */
  async getBOMById(bomId: string): Promise<{
    header: BOMHeader
    lines: BOMLine[]
  }> {
    // جلب الرأس
    const { data: header, error: headerError } = await supabase
      .from('bom_headers')
      .select(`
        *,
        item:items!bom_headers_item_id_fkey(
          item_code,
          item_name
        )
      `)
      .eq('id', bomId)
      .single()

    if (headerError) throw headerError

    // جلب الخطوط
    const { data: lines, error: linesError } = await supabase
      .from('bom_lines')
      .select(`
        *,
        item:items!bom_lines_item_id_fkey(
          item_code,
          item_name,
          unit_of_measure
        )
      `)
      .eq('bom_id', bomId)
      .order('line_number', { ascending: true })

    if (linesError) throw linesError

    return {
      header: {
        ...header,
        item_code: header.item?.item_code,
        item_name: header.item?.item_name
      },
      lines: lines.map(line => ({
        ...line,
        item_code: line.item?.item_code,
        item_name: line.item?.item_name
      }))
    }
  },

  /**
   * إنشاء BOM جديد
   */
  async createBOM(
    header: Omit<BOMHeader, 'id' | 'created_at' | 'updated_at'>,
    lines: Omit<BOMLine, 'id' | 'bom_id'>[]
  ): Promise<string> {
    // إنشاء الرأس
    const { data: newHeader, error: headerError } = await supabase
      .from('bom_headers')
      .insert(header)
      .select()
      .single()

    if (headerError) throw headerError

    // إنشاء الخطوط
    if (lines.length > 0) {
      const linesWithBomId = lines.map(line => ({
        ...line,
        bom_id: newHeader.id
      }))

      const { error: linesError } = await supabase
        .from('bom_lines')
        .insert(linesWithBomId)

      if (linesError) throw linesError
    }

    return newHeader.id
  },

  /**
   * تحديث BOM
   */
  async updateBOM(
    bomId: string,
    header: Partial<BOMHeader>,
    lines?: BOMLine[]
  ): Promise<void> {
    // تحديث الرأس
    const { error: headerError } = await supabase
      .from('bom_headers')
      .update(header)
      .eq('id', bomId)

    if (headerError) throw headerError

    // تحديث الخطوط إذا تم توفيرها
    if (lines) {
      // حذف الخطوط القديمة
      const { error: deleteError } = await supabase
        .from('bom_lines')
        .delete()
        .eq('bom_id', bomId)

      if (deleteError) throw deleteError

      // إضافة الخطوط الجديدة
      if (lines.length > 0) {
        const { error: insertError } = await supabase
          .from('bom_lines')
          .insert(lines)

        if (insertError) throw insertError
      }
    }
  },

  /**
   * حذف BOM
   */
  async deleteBOM(bomId: string): Promise<void> {
    const { error } = await supabase
      .from('bom_headers')
      .delete()
      .eq('id', bomId)

    if (error) throw error
  },

  /**
   * الموافقة على BOM
   */
  async approveBOM(bomId: string, userId: string): Promise<void> {
    const { error } = await supabase
      .from('bom_headers')
      .update({
        status: 'APPROVED',
        approved_by: userId,
        approved_at: new Date().toISOString()
      })
      .eq('id', bomId)

    if (error) throw error
  },

  /**
   * فك BOM (Explosion) - استدعاء دالة SQL
   */
  async explodeBOM(
    bomId: string,
    quantity: number = 1,
    orgId?: string
  ): Promise<BOMExplosionItem[]> {
    const { data, error } = await supabase.rpc('explode_bom', {
      p_bom_id: bomId,
      p_quantity: quantity,
      p_org_id: orgId
    })

    if (error) throw error
    return data || []
  },

  /**
   * حساب تكلفة BOM
   */
  async calculateBOMCost(
    bomId: string,
    quantity: number = 1
  ): Promise<number> {
    const { data, error } = await supabase.rpc('calculate_bom_cost', {
      p_bom_id: bomId,
      p_quantity: quantity
    })

    if (error) throw error
    return data || 0
  },

  /**
   * Where-Used Report - أين يُستخدم المكون؟
   */
  async getWhereUsed(
    itemId: string,
    orgId?: string
  ): Promise<WhereUsedItem[]> {
    const { data, error } = await supabase.rpc('get_where_used', {
      p_item_id: itemId,
      p_org_id: orgId
    })

    if (error) throw error
    return data || []
  },

  /**
   * الحصول على إصدارات BOM
   */
  async getBOMVersions(bomId: string): Promise<BOMVersion[]> {
    const { data, error } = await supabase
      .from('bom_versions')
      .select('*')
      .eq('bom_id', bomId)
      .order('version_number', { ascending: false })

    if (error) throw error
    return data || []
  },

  /**
   * نسخ BOM (Create Copy)
   */
  async copyBOM(
    sourceBomId: string,
    newBomNumber: string,
    orgId: string
  ): Promise<string> {
    // جلب BOM الأصلي
    const { header, lines } = await this.getBOMById(sourceBomId)

    // إنشاء نسخة جديدة
    const newHeader: Omit<BOMHeader, 'id' | 'created_at' | 'updated_at'> = {
      ...header,
      bom_number: newBomNumber,
      status: 'DRAFT',
      bom_version: 1,
      approved_by: undefined,
      approved_at: undefined,
      org_id: orgId
    }

    const newLines = lines.map(line => {
      const { id, bom_id, ...rest } = line
      return rest
    })

    return await this.createBOM(newHeader, newLines)
  },

  /**
   * البحث في BOMs
   */
  async searchBOMs(
    orgId: string,
    searchTerm: string
  ): Promise<BOMHeader[]> {
    const { data, error } = await supabase
      .from('bom_headers')
      .select(`
        *,
        item:items!bom_headers_item_id_fkey(
          item_code,
          item_name
        )
      `)
      .eq('org_id', orgId)
      .or(`bom_number.ilike.%${searchTerm}%,description.ilike.%${searchTerm}%`)
      .order('bom_number', { ascending: false })
      .limit(50)

    if (error) throw error
    
    return data.map(bom => ({
      ...bom,
      item_code: bom.item?.item_code,
      item_name: bom.item?.item_name
    }))
  }
}

export default bomService
