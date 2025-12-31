/**
 * Stage WIP Log List Component
 * Displays and manages Work-in-Process (WIP) logs for manufacturing stages
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { 
  Plus, 
  Edit, 
  Trash2, 
  RefreshCw, 
  Factory
} from 'lucide-react'
import { stageWipLogService } from '@/services/supabase-service'
import { useManufacturingOrders } from '@/hooks/useManufacturingOrders'
import { useManufacturingStages } from '@/hooks/useManufacturingStages'

interface ManufacturingOrder {
  id: string
  order_number?: string
}

interface ManufacturingStage {
  id: string
  name?: string
  name_ar?: string
  code?: string
  is_active?: boolean
  order_sequence?: number
}

interface WipLog {
  id: string
  mo_id?: string
  stage_id?: string
  period_start?: string
  period_end?: string
  units_beginning_wip?: number
  units_started?: number
  units_completed?: number
  units_ending_wip?: number
  cost_material?: number
  cost_labor?: number
  cost_overhead?: number
  total_cost?: number
  eu_material?: number
  eu_conversion?: number
  is_posted?: boolean
}

export function StageWipLogList() {
  const queryClient = useQueryClient()
  
  const [filters, setFilters] = useState({
    moId: 'all',
    stageId: 'all',
    periodStart: '',
    periodEnd: ''
  })

  // Load related data
  const { data: manufacturingOrdersData } = useManufacturingOrders()
  const { data: stagesData } = useManufacturingStages()
  
  // Type assertions - needed because hooks return unknown types
  const manufacturingOrders: ManufacturingOrder[] = Array.isArray(manufacturingOrdersData) 
    ? (manufacturingOrdersData as unknown as ManufacturingOrder[])
    : []
  const stages: ManufacturingStage[] = Array.isArray(stagesData)
    ? (stagesData as unknown as ManufacturingStage[])
    : []

  // Load WIP logs
  const { data: wipLogsData, isLoading, isError, refetch } = useQuery<WipLog[]>({
    queryKey: ['stage-wip-log', filters],
    queryFn: async (): Promise<WipLog[]> => {
      const filtersToUse: Record<string, string> = {}
      if (filters.moId && filters.moId !== 'all') filtersToUse.moId = filters.moId
      if (filters.stageId && filters.stageId !== 'all') filtersToUse.stageId = filters.stageId
      
      const result = await stageWipLogService.getAll(filtersToUse);
      return Array.isArray(result) ? result : [];
    },
    enabled: true
  })
  
  // Use wipLogsData directly as it's already typed as WipLog[] | undefined
  const wipLogs = wipLogsData ?? []

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await stageWipLogService.delete(id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stage-wip-log'] })
      toast.success('تم حذف سجل WIP بنجاح')
    },
    onError: (error: unknown) => {
      const err = error as { message?: string }
      toast.error(`خطأ في حذف السجل: ${err.message || 'حدث خطأ غير متوقع'}`)
    }
  })

  const handleDelete = async (id: string) => {
    if (confirm('هل أنت متأكد من حذف هذا السجل؟')) {
      deleteMutation.mutate(id)
    }
  }

  const handleFilterChange = (field: string, value: string) => {
    setFilters(prev => ({ ...prev, [field]: value }))
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Factory className="h-6 w-6 text-primary" />
              <div>
                <CardTitle className="wardah-text-gradient-google">
                  سجلات العمل قيد التنفيذ (WIP Log)
                </CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  تتبع ومراقبة العمل قيد التنفيذ لكل مرحلة تصنيع
                  {/* Note: Create/Edit dialogs will be implemented in future updates */}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetch()}
                disabled={isLoading}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                تحديث
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  // Note: Create dialog will be implemented in future updates
                  toast.info('إنشاء سجل WIP جديد - قيد التطوير')
                }}
              >
                <Plus className="h-4 w-4 mr-2" />
                إضافة سجل
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {/* Filters */}
          <div className="grid md:grid-cols-4 gap-4 mb-6">
            <div>
              <Label htmlFor="mo-filter">أمر التصنيع</Label>
              <Select
                value={filters.moId}
                onValueChange={(value) => handleFilterChange('moId', value)}
              >
                <SelectTrigger id="mo-filter">
                  <SelectValue placeholder="جميع الأوامر" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">جميع الأوامر</SelectItem>
                  {manufacturingOrders.map((mo) => (
                    <SelectItem key={mo.id} value={mo.id}>
                      {mo.order_number || mo.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="stage-filter">المرحلة</Label>
              <Select
                value={filters.stageId}
                onValueChange={(value) => handleFilterChange('stageId', value)}
              >
                <SelectTrigger id="stage-filter">
                  <SelectValue placeholder="جميع المراحل" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">جميع المراحل</SelectItem>
                  {stages
                    .filter((stage) => (stage as { is_active?: boolean }).is_active)
                    .sort((a, b) => {
                      const aSeq = (a as { order_sequence?: number }).order_sequence || 0
                      const bSeq = (b as { order_sequence?: number }).order_sequence || 0
                      return aSeq - bSeq
                    })
                    .map((stage) => (
                      <SelectItem key={stage.id} value={stage.id}>
                        {stage.code || stage.id} - {stage.name_ar || stage.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="period-start">من تاريخ</Label>
              <Input
                id="period-start"
                type="date"
                value={filters.periodStart}
                onChange={(e) => handleFilterChange('periodStart', e.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="period-end">إلى تاريخ</Label>
              <Input
                id="period-end"
                type="date"
                value={filters.periodEnd}
                onChange={(e) => handleFilterChange('periodEnd', e.target.value)}
              />
            </div>
          </div>

          {/* Loading State */}
          {isLoading && (
            <div className="text-center py-8">
              <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-2 text-muted-foreground" />
              <p className="text-muted-foreground">جاري تحميل البيانات...</p>
            </div>
          )}

          {/* Error State */}
          {isError && (
            <div className="text-center py-8">
              <p className="text-destructive">حدث خطأ في تحميل البيانات</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetch()}
                className="mt-4"
              >
                إعادة المحاولة
              </Button>
            </div>
          )}

          {/* Table */}
          {!isLoading && !isError && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>أمر التصنيع</TableHead>
                    <TableHead>المرحلة</TableHead>
                    <TableHead>الفترة</TableHead>
                    <TableHead>الوحدات</TableHead>
                    <TableHead>التكاليف</TableHead>
                    <TableHead>الوحدات المعادلة</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead>الإجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {wipLogs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                        لا توجد سجلات WIP
                      </TableCell>
                    </TableRow>
                  ) : (
                    wipLogs.map((log) => {
                      const stage = stages.find((s) => s.id === log.stage_id)
                      const mo = manufacturingOrders.find((m) => m.id === log.mo_id)
                      
                      return (
                        <TableRow key={log.id}>
                          <TableCell>
                            {mo?.order_number || log.mo_id?.substring(0, 8)}
                          </TableCell>
                          <TableCell>
                            {stage?.code || 'N/A'} - {stage?.name_ar || stage?.name || 'N/A'}
                          </TableCell>
                          <TableCell>
                            {new Date(log.period_start).toLocaleDateString('ar-SA')} -{' '}
                            {new Date(log.period_end).toLocaleDateString('ar-SA')}
                          </TableCell>
                          <TableCell>
                            <div className="text-sm">
                              <div>بداية: {log.units_beginning_wip || 0}</div>
                              <div>بدأ: {log.units_started || 0}</div>
                              <div>مكتمل: {log.units_completed || 0}</div>
                              <div>نهاية: {log.units_ending_wip || 0}</div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="text-sm">
                              <div>مواد: {Number(log.cost_material || 0).toFixed(2)}</div>
                              <div>عمل: {Number(log.cost_labor || 0).toFixed(2)}</div>
                              <div>مصروفات: {Number(log.cost_overhead || 0).toFixed(2)}</div>
                              <div className="font-medium">إجمالي: {Number(log.total_cost || 0).toFixed(2)}</div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="text-sm">
                              <div>مواد: {Number(log.eu_material || 0).toFixed(2)}</div>
                              <div>تحويل: {Number(log.eu_conversion || 0).toFixed(2)}</div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={log.is_posted ? 'default' : 'outline'}>
                              {log.is_posted ? 'منشور' : 'مسودات'}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  // Note: Edit dialog will be implemented in future updates
                                  toast.info('تعديل سجل WIP - قيد التطوير')
                                }}
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDelete(log.id)}
                                disabled={deleteMutation.isPending}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

