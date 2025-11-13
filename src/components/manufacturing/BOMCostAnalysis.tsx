/**
 * BOM Cost Analysis Component
 * مكون تحليل تكلفة BOM
 */

import { useState, useEffect } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { 
  DollarSign, 
  TrendingUp, 
  TrendingDown,
  Calculator,
  RefreshCw
} from 'lucide-react'
import { bomCostingService, BOMCostComparison } from '@/services/manufacturing/bomCostingService'
import { toast } from 'sonner'

interface BOMCostAnalysisProps {
  bomId: string
  quantity?: number
}

export function BOMCostAnalysis({ bomId, quantity = 1 }: BOMCostAnalysisProps) {
  const [standardCost, setStandardCost] = useState<any>(null)
  const [comparison, setComparison] = useState<BOMCostComparison[]>([])
  const [loading, setLoading] = useState(false)

  const loadData = async () => {
    setLoading(true)
    try {
      const [standard, comp] = await Promise.all([
        bomCostingService.calculateStandardCost(bomId, quantity),
        bomCostingService.compareCosts(bomId, quantity)
      ])
      setStandardCost(standard)
      setComparison(comp)
    } catch (error: any) {
      toast.error(`خطأ في تحميل البيانات: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (bomId) {
      loadData()
    }
  }, [bomId, quantity])

  const getVarianceColor = (variance: number, variancePct: number) => {
    if (variancePct > 5) return 'text-destructive'
    if (variancePct < -5) return 'text-green-600'
    return 'text-muted-foreground'
  }

  const getVarianceIcon = (variance: number) => {
    if (variance > 0) return <TrendingUp className="h-4 w-4" />
    if (variance < 0) return <TrendingDown className="h-4 w-4" />
    return null
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Calculator className="h-5 w-5" />
              تحليل التكلفة المعيارية
            </CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={loadData}
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              تحديث
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : standardCost ? (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="space-y-1">
                <Label className="text-sm text-muted-foreground">تكلفة المواد</Label>
                <div className="text-2xl font-bold">
                  {standardCost.material_cost.toFixed(2)} ريال
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-sm text-muted-foreground">تكلفة العمالة</Label>
                <div className="text-2xl font-bold">
                  {standardCost.labor_cost.toFixed(2)} ريال
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-sm text-muted-foreground">التكاليف غير المباشرة</Label>
                <div className="text-2xl font-bold">
                  {standardCost.overhead_cost.toFixed(2)} ريال
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-sm text-muted-foreground">التكلفة الإجمالية</Label>
                <div className="text-2xl font-bold text-primary">
                  {standardCost.total_cost.toFixed(2)} ريال
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-sm text-muted-foreground">التكلفة للوحدة</Label>
                <div className="text-2xl font-bold">
                  {standardCost.unit_cost.toFixed(2)} ريال
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              لا توجد بيانات
            </div>
          )}
        </CardContent>
      </Card>

      {comparison.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5" />
              مقارنة التكاليف (المعياري vs الفعلي)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>نوع التكلفة</TableHead>
                  <TableHead>معياري</TableHead>
                  <TableHead>فعلي</TableHead>
                  <TableHead>التباين</TableHead>
                  <TableHead>نسبة التباين</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {comparison.map((item, index) => (
                  <TableRow key={index}>
                    <TableCell className="font-medium">{item.cost_type}</TableCell>
                    <TableCell>{item.standard_cost.toFixed(2)} ريال</TableCell>
                    <TableCell>{item.actual_cost.toFixed(2)} ريال</TableCell>
                    <TableCell>
                      <div className={`flex items-center gap-1 ${getVarianceColor(item.variance, item.variance_pct)}`}>
                        {getVarianceIcon(item.variance)}
                        {item.variance.toFixed(2)} ريال
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge 
                        variant={Math.abs(item.variance_pct) > 5 ? 'destructive' : 'secondary'}
                      >
                        {item.variance_pct > 0 ? '+' : ''}{item.variance_pct.toFixed(2)}%
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

