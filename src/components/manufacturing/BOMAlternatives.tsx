/**
 * BOM Alternatives Component
 * مكون إدارة BOMs البديلة
 */

import { useState, useEffect } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Plus, Edit, Trash2, CheckCircle } from 'lucide-react'
import { bomAlternativeService, BOMAlternative } from '@/services/manufacturing/bomAlternativeService'
import { toast } from 'sonner'

interface BOMAlternativesProps {
  primaryBomId: string
  onAlternativeSelect?: (alternativeBomId: string) => void
}

export function BOMAlternatives({ primaryBomId, onAlternativeSelect }: BOMAlternativesProps) {
  const [alternatives, setAlternatives] = useState<BOMAlternative[]>([])
  const [loading, setLoading] = useState(false)

  const loadAlternatives = async () => {
    setLoading(true)
    try {
      const data = await bomAlternativeService.getAlternatives(primaryBomId)
      setAlternatives(data)
    } catch (error: any) {
      toast.error(`خطأ في تحميل البدائل: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (primaryBomId) {
      loadAlternatives()
    }
  }, [primaryBomId])

  const handleSelect = (alternativeBomId: string) => {
    if (onAlternativeSelect) {
      onAlternativeSelect(alternativeBomId)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>BOMs البديلة</CardTitle>
          <Button size="sm" variant="outline">
            <Plus className="h-4 w-4 mr-2" />
            إضافة بديل
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-center py-8 text-muted-foreground">جاري التحميل...</div>
        ) : alternatives.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            لا توجد BOMs بديلة
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الأولوية</TableHead>
                <TableHead>BOM البديل</TableHead>
                <TableHead>السبب</TableHead>
                <TableHead>نطاق الكمية</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>الإجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {alternatives.map((alt) => (
                <TableRow key={alt.id}>
                  <TableCell>{alt.priority}</TableCell>
                  <TableCell>{alt.alternative_bom_id}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{alt.reason_code || 'CUSTOM'}</Badge>
                  </TableCell>
                  <TableCell>
                    {alt.min_quantity && alt.max_quantity
                      ? `${alt.min_quantity} - ${alt.max_quantity}`
                      : 'غير محدد'}
                  </TableCell>
                  <TableCell>
                    {alt.is_active ? (
                      <Badge variant="default">نشط</Badge>
                    ) : (
                      <Badge variant="secondary">غير نشط</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleSelect(alt.alternative_bom_id)}
                      >
                        <CheckCircle className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="ghost">
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="ghost">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

