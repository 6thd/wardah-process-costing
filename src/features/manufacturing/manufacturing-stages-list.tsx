import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader, CardContent, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import {
  Factory,
  Plus,
  Edit,
  Trash2,
  RefreshCw,
  Settings
} from 'lucide-react'
import { useManufacturingStages } from '@/hooks/useManufacturingStages'
import { manufacturingStagesService } from '@/services/supabase-service'

export function ManufacturingStagesList() {
  const queryClient = useQueryClient()
  const { data: stages = [], isLoading, isError, refetch } = useManufacturingStages()
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingStage, setEditingStage] = useState<any>(null)
  const [formData, setFormData] = useState({
    code: '',
    name: '',
    name_ar: '',
    description: '',
    order_sequence: 1,
    is_active: true
  })

  const handleInputChange = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const handleEdit = (stage: any) => {
    setEditingStage(stage)
    setFormData({
      code: stage.code || '',
      name: stage.name || '',
      name_ar: stage.name_ar || '',
      description: stage.description || '',
      order_sequence: stage.order_sequence || 1,
      is_active: stage.is_active !== false
    })
    setIsDialogOpen(true)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('هل أنت متأكد من حذف هذه المرحلة؟')) return

    try {
      await manufacturingStagesService.delete(id)
      toast.success('تم حذف المرحلة بنجاح')
      queryClient.invalidateQueries({ queryKey: ['manufacturing-stages'] })
    } catch (error: any) {
      toast.error(`خطأ في حذف المرحلة: ${error.message}`)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      if (editingStage) {
        await manufacturingStagesService.update(editingStage.id, formData)
        toast.success('تم تحديث المرحلة بنجاح')
      } else {
        await manufacturingStagesService.create(formData)
        toast.success('تم إنشاء المرحلة بنجاح')
      }
      setIsDialogOpen(false)
      setEditingStage(null)
      setFormData({
        code: '',
        name: '',
        name_ar: '',
        description: '',
        order_sequence: 1,
        is_active: true
      })
      queryClient.invalidateQueries({ queryKey: ['manufacturing-stages'] })
    } catch (error: any) {
      toast.error(`خطأ: ${error.message}`)
    }
  }

  const handleNew = () => {
    setEditingStage(null)
    setFormData({
      code: '',
      name: '',
      name_ar: '',
      description: '',
      order_sequence: (stages.length || 0) + 1,
      is_active: true
    })
    setIsDialogOpen(true)
  }

  if (isLoading) {
    return (
      <Card className="wardah-glass-card">
        <CardContent className="p-6">
          <div className="flex items-center justify-center">
            <RefreshCw className="h-6 w-6 animate-spin mr-2" />
            <p>جاري تحميل المراحل...</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (isError) {
    return (
      <Card className="wardah-glass-card">
        <CardContent className="p-6">
          <div className="text-red-500">
            <p>حدث خطأ في تحميل المراحل</p>
            <Button onClick={() => refetch()} className="mt-4">
              <RefreshCw className="h-4 w-4 mr-2" />
              إعادة المحاولة
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <Card className="wardah-glass-card">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Factory className="h-6 w-6 text-primary" />
              <CardTitle>مراحل التصنيع (Manufacturing Stages)</CardTitle>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetch()}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                تحديث
              </Button>
              <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogTrigger asChild>
                  <Button onClick={handleNew}>
                    <Plus className="h-4 w-4 mr-2" />
                    إضافة مرحلة
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[600px]">
                  <form onSubmit={handleSubmit}>
                    <DialogHeader>
                      <DialogTitle>
                        {editingStage ? 'تعديل المرحلة' : 'إضافة مرحلة جديدة'}
                      </DialogTitle>
                      <DialogDescription>
                        {editingStage 
                          ? 'قم بتعديل بيانات المرحلة' 
                          : 'أدخل بيانات المرحلة الجديدة'}
                      </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="code">كود المرحلة *</Label>
                          <Input
                            id="code"
                            value={formData.code}
                            onChange={(e) => handleInputChange('code', e.target.value)}
                            placeholder="MIX"
                            required
                            disabled={!!editingStage}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="order_sequence">ترتيب المرحلة *</Label>
                          <Input
                            id="order_sequence"
                            type="number"
                            value={formData.order_sequence}
                            onChange={(e) => handleInputChange('order_sequence', Number.parseInt(e.target.value, 10))}
                            min={1}
                            required
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="name">اسم المرحلة (إنجليزي) *</Label>
                        <Input
                          id="name"
                          value={formData.name}
                          onChange={(e) => handleInputChange('name', e.target.value)}
                          placeholder="Mixing"
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="name_ar">اسم المرحلة (عربي)</Label>
                        <Input
                          id="name_ar"
                          value={formData.name_ar}
                          onChange={(e) => handleInputChange('name_ar', e.target.value)}
                          placeholder="الخلط"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="description">الوصف</Label>
                        <Textarea
                          id="description"
                          value={formData.description}
                          onChange={(e) => handleInputChange('description', e.target.value)}
                          placeholder="وصف المرحلة..."
                          rows={3}
                        />
                      </div>
                      <div className="flex items-center space-x-2 space-x-reverse">
                        <input
                          type="checkbox"
                          id="is_active"
                          checked={formData.is_active}
                          onChange={(e) => handleInputChange('is_active', e.target.checked)}
                          className="h-4 w-4"
                        />
                        <Label htmlFor="is_active">نشط</Label>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setIsDialogOpen(false)}
                      >
                        إلغاء
                      </Button>
                      <Button type="submit">
                        {editingStage ? 'حفظ التعديلات' : 'إضافة'}
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {stages.length === 0 ? (
            <div className="text-center py-8">
              <Factory className="h-12 w-12 mx-auto mb-4 text-gray-400" />
              <p className="text-gray-500 mb-4">لا توجد مراحل تصنيع</p>
              <Button onClick={handleNew}>
                <Plus className="h-4 w-4 mr-2" />
                إضافة مرحلة جديدة
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الكود</TableHead>
                    <TableHead>الاسم</TableHead>
                    <TableHead>الاسم (عربي)</TableHead>
                    <TableHead>الترتيب</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead>الوصف</TableHead>
                    <TableHead>الإجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...stages]
                    .sort((a, b) => (a.order_sequence || 0) - (b.order_sequence || 0))
                    .map((stage) => (
                      <TableRow key={stage.id}>
                        <TableCell className="font-mono font-semibold">
                          {stage.code}
                        </TableCell>
                        <TableCell>{stage.name}</TableCell>
                        <TableCell>{stage.name_ar || '-'}</TableCell>
                        <TableCell>{stage.order_sequence}</TableCell>
                        <TableCell>
                          <Badge variant={stage.is_active ? 'default' : 'secondary'}>
                            {stage.is_active ? 'نشط' : 'غير نشط'}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-xs truncate">
                          {stage.description || '-'}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleEdit(stage)}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleDelete(stage.id)}
                              className="text-red-500 hover:text-red-700"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

