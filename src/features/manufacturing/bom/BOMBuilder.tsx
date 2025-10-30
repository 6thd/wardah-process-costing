/**
 * BOM Builder Component
 * واجهة إنشاء وتعديل قوائم المواد
 */

import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardHeader, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Plus, Trash2, Save, X, Search } from 'lucide-react'
import { useBOM, useCreateBOM, useUpdateBOM } from '@/hooks/manufacturing/useBOM'
import { BOMLine } from '@/services/manufacturing/bomService'
import { useAuthStore } from '@/store/auth-store'

interface BOMLineInput extends Omit<BOMLine, 'id' | 'bom_id' | 'org_id'> {
  tempId: string
}

export function BOMBuilder() {
  const { bomId } = useParams<{ bomId: string }>()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const orgId = 'default-org-id' // TODO: Get from user context
  
  // Fetch existing BOM if editing
  const { data: bomData } = useBOM(bomId)
  
  // Mutations
  const createBOM = useCreateBOM(orgId)
  const updateBOM = useUpdateBOM(orgId)

  // Form state
  const [bomNumber, setBomNumber] = useState('')
  const [itemId, setItemId] = useState('')
  const [itemCode, setItemCode] = useState('')
  const [description, setDescription] = useState('')
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().split('T')[0])
  const [notes, setNotes] = useState('')
  
  // Lines state
  const [bomLines, setBomLines] = useState<BOMLineInput[]>([])
  const [nextLineNumber, setNextLineNumber] = useState(10)

  // Load existing BOM data
  useEffect(() => {
    if (bomData) {
      setBomNumber(bomData.header.bom_number)
      setItemId(bomData.header.item_id)
      setItemCode(bomData.header.item_code || '')
      setDescription(bomData.header.description || '')
      setEffectiveDate(bomData.header.effective_date)
      setNotes(bomData.header.notes || '')
      
      setBomLines(
        bomData.lines.map(line => ({
          ...line,
          tempId: crypto.randomUUID()
        }))
      )
      
      if (bomData.lines.length > 0) {
        const maxLineNumber = Math.max(...bomData.lines.map(l => l.line_number))
        setNextLineNumber(maxLineNumber + 10)
      }
    }
  }, [bomData])

  // Add new line
  const addLine = () => {
    const newLine: BOMLineInput = {
      tempId: crypto.randomUUID(),
      line_number: nextLineNumber,
      item_id: '',
      item_code: '',
      item_name: '',
      quantity: 1,
      unit_of_measure: 'EA',
      line_type: 'COMPONENT',
      scrap_factor: 0,
      is_critical: false,
      yield_percentage: 100,
      operation_sequence: undefined,
      notes: '',
      effective_from: effectiveDate
    }
    
    setBomLines([...bomLines, newLine])
    setNextLineNumber(nextLineNumber + 10)
  }

  // Remove line
  const removeLine = (tempId: string) => {
    setBomLines(bomLines.filter(line => line.tempId !== tempId))
  }

  // Update line
  const updateLine = (tempId: string, field: keyof BOMLineInput, value: any) => {
    setBomLines(
      bomLines.map(line =>
        line.tempId === tempId ? { ...line, [field]: value } : line
      )
    )
  }

  // Save BOM
  const handleSave = async () => {
    if (!bomNumber || !itemId || bomLines.length === 0) {
      alert('الرجاء ملء جميع الحقول المطلوبة وإضافة مكون واحد على الأقل')
      return
    }

    const header = {
      bom_number: bomNumber,
      item_id: itemId,
      description,
      bom_version: 1,
      is_active: true,
      effective_date: effectiveDate,
      unit_cost: 0,
      status: 'DRAFT' as const,
      notes,
      org_id: orgId
    }

    const lines = bomLines.map(({ tempId, item_code, item_name, ...line }) => ({
      ...line,
      org_id: orgId
    })) as any // Type assertion to fix type mismatch

    try {
      if (bomId) {
        await updateBOM.mutateAsync({
          bomId,
          header,
          lines
        })
      } else {
        await createBOM.mutateAsync({
          header,
          lines
        })
      }
      
      navigate('/manufacturing/bom')
    } catch (error) {
      console.error('Error saving BOM:', error)
    }
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold wardah-text-gradient-google">
            {bomId ? 'تعديل قائمة المواد' : 'قائمة مواد جديدة'}
          </h1>
          <p className="text-muted-foreground mt-1">
            {bomId ? 'Edit Bill of Materials' : 'New Bill of Materials'}
          </p>
        </div>
        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={() => navigate('/manufacturing/bom')}
          >
            <X className="w-4 h-4 mr-2" />
            إلغاء
          </Button>
          <Button
            onClick={handleSave}
            disabled={createBOM.isPending || updateBOM.isPending}
          >
            <Save className="w-4 h-4 mr-2" />
            حفظ
          </Button>
        </div>
      </div>

      {/* BOM Header Card */}
      <Card className="wardah-glass-card">
        <CardHeader>
          <h2 className="text-xl font-bold">معلومات القائمة</h2>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <Label>رقم القائمة *</Label>
              <Input
                value={bomNumber}
                onChange={(e) => setBomNumber(e.target.value)}
                placeholder="BOM-001"
              />
            </div>
            
            <div>
              <Label>رمز الصنف *</Label>
              <div className="flex gap-2">
                <Input
                  value={itemCode}
                  onChange={(e) => setItemCode(e.target.value)}
                  placeholder="ITEM-001"
                />
                <Button size="icon" variant="outline">
                  <Search className="w-4 h-4" />
                </Button>
              </div>
            </div>
            
            <div>
              <Label>تاريخ السريان</Label>
              <Input
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
              />
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-4 mt-4">
            <div>
              <Label>الوصف</Label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="وصف القائمة"
              />
            </div>
            
            <div>
              <Label>ملاحظات</Label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="ملاحظات إضافية"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* BOM Lines Card */}
      <Card className="wardah-glass-card">
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold">مكونات القائمة</h2>
            <Button onClick={addLine} size="sm">
              <Plus className="w-4 h-4 mr-2" />
              إضافة مكون
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {bomLines.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <p>لا توجد مكونات</p>
              <p className="text-sm mt-2">اضغط "إضافة مكون" لبدء بناء القائمة</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b">
                    <th className="text-right p-2">#</th>
                    <th className="text-right p-2">رمز المادة *</th>
                    <th className="text-right p-2">اسم المادة</th>
                    <th className="text-right p-2">الكمية *</th>
                    <th className="text-right p-2">الوحدة</th>
                    <th className="text-right p-2">هالك %</th>
                    <th className="text-right p-2">حرج</th>
                    <th className="text-right p-2">النوع</th>
                    <th className="text-right p-2">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {bomLines.map((line, index) => (
                    <tr key={line.tempId} className="border-b hover:bg-muted/50">
                      <td className="p-2">{line.line_number}</td>
                      <td className="p-2">
                        <Input
                          value={line.item_code}
                          onChange={(e) => updateLine(line.tempId, 'item_code', e.target.value)}
                          placeholder="رمز المادة"
                          className="w-32"
                        />
                      </td>
                      <td className="p-2">
                        <Input
                          value={line.item_name}
                          onChange={(e) => updateLine(line.tempId, 'item_name', e.target.value)}
                          placeholder="اسم المادة"
                          className="w-40"
                        />
                      </td>
                      <td className="p-2">
                        <Input
                          type="number"
                          value={line.quantity}
                          onChange={(e) => updateLine(line.tempId, 'quantity', parseFloat(e.target.value))}
                          className="w-24"
                          step="0.01"
                        />
                      </td>
                      <td className="p-2">
                        <select
                          value={line.unit_of_measure}
                          onChange={(e) => updateLine(line.tempId, 'unit_of_measure', e.target.value)}
                          className="w-20 px-2 py-1 border rounded"
                        >
                          <option value="EA">EA</option>
                          <option value="KG">KG</option>
                          <option value="L">L</option>
                          <option value="M">M</option>
                        </select>
                      </td>
                      <td className="p-2">
                        <Input
                          type="number"
                          value={line.scrap_factor}
                          onChange={(e) => updateLine(line.tempId, 'scrap_factor', parseFloat(e.target.value))}
                          className="w-20"
                          min="0"
                          max="100"
                          step="0.1"
                        />
                      </td>
                      <td className="p-2 text-center">
                        <input
                          type="checkbox"
                          checked={line.is_critical}
                          onChange={(e) => updateLine(line.tempId, 'is_critical', e.target.checked)}
                          className="w-4 h-4"
                        />
                      </td>
                      <td className="p-2">
                        <select
                          value={line.line_type}
                          onChange={(e) => updateLine(line.tempId, 'line_type', e.target.value)}
                          className="w-32 px-2 py-1 border rounded text-sm"
                        >
                          <option value="COMPONENT">مكون</option>
                          <option value="PHANTOM">وهمي</option>
                          <option value="REFERENCE">مرجع</option>
                        </select>
                      </td>
                      <td className="p-2">
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => removeLine(line.tempId)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          
          {bomLines.length > 0 && (
            <div className="mt-4 flex justify-between items-center text-sm text-muted-foreground">
              <span>عدد المكونات: {bomLines.length}</span>
              <span>
                المواد الحرجة: {bomLines.filter(l => l.is_critical).length}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Summary */}
      {bomLines.length > 0 && (
        <Card className="wardah-glass-card bg-blue-50/50">
          <CardContent className="p-4">
            <div className="grid md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">إجمالي الكمية</p>
                <p className="text-2xl font-bold">
                  {bomLines.reduce((sum, line) => sum + line.quantity, 0).toFixed(2)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">مواد حرجة</p>
                <p className="text-2xl font-bold text-red-600">
                  {bomLines.filter(l => l.is_critical).length}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">متوسط الهالك</p>
                <p className="text-2xl font-bold text-orange-600">
                  {(bomLines.reduce((sum, line) => sum + line.scrap_factor, 0) / bomLines.length).toFixed(1)}%
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">الحالة</p>
                <Badge className="mt-1">مسودة</Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
