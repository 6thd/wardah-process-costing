/**
 * Standard Costs List Component
 * Displays and manages standard costs for products and manufacturing stages
 */

import React, { useState } from 'react'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { 
  Plus, 
  Edit, 
  Trash2, 
  RefreshCw, 
  DollarSign
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { standardCostsService } from '@/services/supabase-service'
import { useManufacturingStages } from '@/hooks/useManufacturingStages'
import { supabase } from '@/lib/supabase'

export function StandardCostsList() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  
  const [filters, setFilters] = useState({
    productId: 'all',
    stageId: 'all',
    isActive: true
  })

  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingCost, setEditingCost] = useState<any>(null)
  const [formData, setFormData] = useState({
    product_id: '',
    stage_id: '',
    material_cost_per_unit: 0,
    labor_cost_per_unit: 0,
    overhead_cost_per_unit: 0,
    effective_from: new Date().toISOString().split('T')[0],
    effective_to: '',
    is_active: true,
    notes: ''
  })

  // Load related data
  const { data: stages = [] } = useManufacturingStages()
  const [products, setProducts] = useState<any[]>([])

  // Load products
  React.useEffect(() => {
    const loadProducts = async () => {
      try {
        const { data, error } = await supabase
          .from('products')
          .select('id, code, name, name_ar')
          .order('code')
          .limit(100)

        if (error) throw error
        setProducts(data || [])
      } catch (error: any) {
        console.error('Error loading products:', error)
      }
    }
    loadProducts()
  }, [])

  // Load standard costs
  const { data: standardCosts = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['standard-costs', filters],
    queryFn: async () => {
      const filtersToUse: any = {}
      if (filters.productId && filters.productId !== 'all') filtersToUse.productId = filters.productId
      if (filters.stageId && filters.stageId !== 'all') filtersToUse.stageId = filters.stageId
      if (filters.isActive !== undefined) filtersToUse.isActive = filters.isActive
      
      return standardCostsService.getAll(filtersToUse)
    },
    enabled: true
  })

  // Create/Update mutation
  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      if (editingCost) {
        return standardCostsService.update(editingCost.id, data)
      } else {
        return standardCostsService.create(data)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['standard-costs'] })
      toast.success(editingCost ? 'تم تحديث التكلفة القياسية بنجاح' : 'تم إنشاء التكلفة القياسية بنجاح')
      setIsDialogOpen(false)
      resetForm()
    },
    onError: (error: any) => {
      toast.error(`خطأ: ${error.message}`)
    }
  })

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      // Use update to soft delete by setting is_active to false
      await standardCostsService.update(id, { is_active: false })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['standard-costs'] })
      toast.success('تم حذف التكلفة القياسية بنجاح')
    },
    onError: (error: any) => {
      toast.error(`خطأ في حذف التكلفة: ${error.message}`)
    }
  })

  const handleInputChange = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const handleEdit = (cost: any) => {
    setEditingCost(cost)
    setFormData({
      product_id: cost.product_id || '',
      stage_id: cost.stage_id || '',
      material_cost_per_unit: cost.material_cost_per_unit || 0,
      labor_cost_per_unit: cost.labor_cost_per_unit || 0,
      overhead_cost_per_unit: cost.overhead_cost_per_unit || 0,
      effective_from: cost.effective_from ? cost.effective_from.split('T')[0] : new Date().toISOString().split('T')[0],
      effective_to: cost.effective_to ? cost.effective_to.split('T')[0] : '',
      is_active: cost.is_active !== false,
      notes: cost.notes || ''
    })
    setIsDialogOpen(true)
  }

  const handleDelete = async (id: string) => {
    if (confirm('هل أنت متأكد من حذف هذه التكلفة القياسية؟')) {
      deleteMutation.mutate(id)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!formData.product_id || !formData.stage_id) {
      toast.error('يجب اختيار المنتج والمرحلة')
      return
    }

    saveMutation.mutate(formData)
  }

  const resetForm = () => {
    setEditingCost(null)
    setFormData({
      product_id: '',
      stage_id: '',
      material_cost_per_unit: 0,
      labor_cost_per_unit: 0,
      overhead_cost_per_unit: 0,
      effective_from: new Date().toISOString().split('T')[0],
      effective_to: '',
      is_active: true,
      notes: ''
    })
  }

  const handleFilterChange = (field: string, value: string | boolean) => {
    setFilters(prev => ({ ...prev, [field]: value }))
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <DollarSign className="h-6 w-6 text-primary" />
              <div>
                <CardTitle className="wardah-text-gradient-google">
                  التكاليف القياسية (Standard Costs)
                </CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  إدارة التكاليف القياسية للمنتجات والمراحل لتحليل الانحرافات
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
              <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogTrigger asChild>
                  <Button
                    size="sm"
                    onClick={() => {
                      resetForm()
                      setIsDialogOpen(true)
                    }}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    إضافة تكلفة قياسية
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>
                      {editingCost ? 'تعديل التكلفة القياسية' : 'إضافة تكلفة قياسية جديدة'}
                    </DialogTitle>
                    <DialogDescription>
                      حدد المنتج والمرحلة وأدخل التكاليف القياسية
                    </DialogDescription>
                  </DialogHeader>
                  <form onSubmit={handleSubmit}>
                    <div className="grid gap-4 py-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label htmlFor="product">المنتج *</Label>
                          <Select
                            value={formData.product_id}
                            onValueChange={(value) => handleInputChange('product_id', value)}
                            required
                          >
                            <SelectTrigger id="product">
                              <SelectValue placeholder="اختر المنتج" />
                            </SelectTrigger>
                            <SelectContent>
                              {products.map((product: any) => (
                                <SelectItem key={product.id} value={product.id}>
                                  {product.code} - {product.name_ar || product.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div>
                          <Label htmlFor="stage">المرحلة *</Label>
                          <Select
                            value={formData.stage_id}
                            onValueChange={(value) => handleInputChange('stage_id', value)}
                            required
                          >
                            <SelectTrigger id="stage">
                              <SelectValue placeholder="اختر المرحلة" />
                            </SelectTrigger>
                            <SelectContent>
                              {stages
                                .filter((stage: any) => stage.is_active)
                                .sort((a: any, b: any) => (a.order_sequence || 0) - (b.order_sequence || 0))
                                .map((stage: any) => (
                                  <SelectItem key={stage.id} value={stage.id}>
                                    {stage.code} - {stage.name_ar || stage.name}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-4">
                        <div>
                          <Label htmlFor="material-cost">تكلفة المواد لكل وحدة</Label>
                          <Input
                            id="material-cost"
                            type="number"
                            step="0.01"
                            min="0"
                            value={formData.material_cost_per_unit}
                            onChange={(e) => handleInputChange('material_cost_per_unit', Number.parseFloat(e.target.value) || 0)}
                          />
                        </div>

                        <div>
                          <Label htmlFor="labor-cost">تكلفة العمالة لكل وحدة</Label>
                          <Input
                            id="labor-cost"
                            type="number"
                            step="0.01"
                            min="0"
                            value={formData.labor_cost_per_unit}
                            onChange={(e) => handleInputChange('labor_cost_per_unit', Number.parseFloat(e.target.value) || 0)}
                          />
                        </div>

                        <div>
                          <Label htmlFor="overhead-cost">تكلفة المصروفات لكل وحدة</Label>
                          <Input
                            id="overhead-cost"
                            type="number"
                            step="0.01"
                            min="0"
                            value={formData.overhead_cost_per_unit}
                            onChange={(e) => handleInputChange('overhead_cost_per_unit', Number.parseFloat(e.target.value) || 0)}
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label htmlFor="effective-from">تاريخ السريان من *</Label>
                          <Input
                            id="effective-from"
                            type="date"
                            value={formData.effective_from}
                            onChange={(e) => handleInputChange('effective_from', e.target.value)}
                            required
                          />
                        </div>

                        <div>
                          <Label htmlFor="effective-to">تاريخ السريان إلى</Label>
                          <Input
                            id="effective-to"
                            type="date"
                            value={formData.effective_to}
                            onChange={(e) => handleInputChange('effective_to', e.target.value)}
                          />
                        </div>
                      </div>

                      <div>
                        <Label htmlFor="notes">ملاحظات</Label>
                        <Input
                          id="notes"
                          value={formData.notes}
                          onChange={(e) => handleInputChange('notes', e.target.value)}
                          placeholder="ملاحظات إضافية..."
                        />
                      </div>

                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id="is-active"
                          checked={formData.is_active}
                          onChange={(e) => handleInputChange('is_active', e.target.checked)}
                          className="rounded"
                        />
                        <Label htmlFor="is-active" className="cursor-pointer">
                          نشط
                        </Label>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setIsDialogOpen(false)
                          resetForm()
                        }}
                      >
                        إلغاء
                      </Button>
                      <Button type="submit" disabled={saveMutation.isPending}>
                        {(() => {
                          if (saveMutation.isPending) return 'جاري الحفظ...';
                          return editingCost ? 'تحديث' : 'إنشاء';
                        })()}
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {/* Filters */}
          <div className="grid md:grid-cols-3 gap-4 mb-6">
            <div>
              <Label htmlFor="product-filter">المنتج</Label>
              <Select
                value={filters.productId}
                onValueChange={(value) => handleFilterChange('productId', value)}
              >
                <SelectTrigger id="product-filter">
                  <SelectValue placeholder="جميع المنتجات" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">جميع المنتجات</SelectItem>
                  {products.map((product: any) => (
                    <SelectItem key={product.id} value={product.id}>
                      {product.code} - {product.name_ar || product.name}
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
                    .filter((stage: any) => stage.is_active)
                    .sort((a: any, b: any) => (a.order_sequence || 0) - (b.order_sequence || 0))
                    .map((stage: any) => (
                      <SelectItem key={stage.id} value={stage.id}>
                        {stage.code} - {stage.name_ar || stage.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="active-filter">الحالة</Label>
              <Select
                value={filters.isActive ? 'true' : 'false'}
                onValueChange={(value) => handleFilterChange('isActive', value === 'true')}
              >
                <SelectTrigger id="active-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="true">نشط</SelectItem>
                  <SelectItem value="false">غير نشط</SelectItem>
                </SelectContent>
              </Select>
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
                    <TableHead>المنتج</TableHead>
                    <TableHead>المرحلة</TableHead>
                    <TableHead>تكلفة المواد</TableHead>
                    <TableHead>تكلفة العمالة</TableHead>
                    <TableHead>تكلفة المصروفات</TableHead>
                    <TableHead>الإجمالي</TableHead>
                    <TableHead>تاريخ السريان</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead>الإجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {standardCosts.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                        لا توجد تكاليف قياسية
                      </TableCell>
                    </TableRow>
                  ) : (
                    standardCosts.map((cost: any) => {
                      const stage = stages.find((s: any) => s.id === cost.stage_id)
                      const product = products.find((p: any) => p.id === cost.product_id)
                      const totalCost = (cost.material_cost_per_unit || 0) + 
                                       (cost.labor_cost_per_unit || 0) + 
                                       (cost.overhead_cost_per_unit || 0)
                      
                      return (
                        <TableRow key={cost.id}>
                          <TableCell>
                            {product?.code || 'N/A'} - {product?.name_ar || product?.name || 'N/A'}
                          </TableCell>
                          <TableCell>
                            {stage?.code || 'N/A'} - {stage?.name_ar || stage?.name || 'N/A'}
                          </TableCell>
                          <TableCell>
                            {Number(cost.material_cost_per_unit || 0).toFixed(2)} ريال
                          </TableCell>
                          <TableCell>
                            {Number(cost.labor_cost_per_unit || 0).toFixed(2)} ريال
                          </TableCell>
                          <TableCell>
                            {Number(cost.overhead_cost_per_unit || 0).toFixed(2)} ريال
                          </TableCell>
                          <TableCell className="font-medium">
                            {totalCost.toFixed(2)} ريال
                          </TableCell>
                          <TableCell>
                            <div className="text-sm">
                              <div>من: {new Date(cost.effective_from).toLocaleDateString('ar-SA')}</div>
                              {cost.effective_to && (
                                <div>إلى: {new Date(cost.effective_to).toLocaleDateString('ar-SA')}</div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={cost.is_active ? 'default' : 'outline'}>
                              {cost.is_active ? 'نشط' : 'غير نشط'}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleEdit(cost)}
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDelete(cost.id)}
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


