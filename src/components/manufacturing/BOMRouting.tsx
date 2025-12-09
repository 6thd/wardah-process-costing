/**
 * BOM Routing Component
 * مكون إدارة عمليات التصنيع (Routing)
 */

import { useState, useEffect } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Plus, Edit, Trash2, Calculator, Clock } from 'lucide-react'
import { bomRoutingService, BOMOperation, RoutingCost } from '@/services/manufacturing/bomRoutingService'
import { toast } from 'sonner'

interface BOMRoutingProps {
  readonly bomId: string
  readonly quantity?: number
}

export function BOMRouting({ bomId, quantity = 1 }: BOMRoutingProps) {
  const [operations, setOperations] = useState<BOMOperation[]>([])
  const [routingCosts, setRoutingCosts] = useState<RoutingCost[]>([])
  const [loading, setLoading] = useState(false)
  const [totalCost, setTotalCost] = useState(0)

  const loadData = async () => {
    setLoading(true)
    try {
      const [ops, costs, total] = await Promise.all([
        bomRoutingService.getOperations(bomId),
        bomRoutingService.calculateRoutingCost(bomId, quantity),
        bomRoutingService.calculateTotalRoutingCost(bomId, quantity)
      ])
      setOperations(ops)
      setRoutingCosts(costs)
      setTotalCost(total)
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

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Calculator className="h-5 w-5" />
              عمليات التصنيع (Routing)
            </CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-lg">
                إجمالي التكلفة: {totalCost.toFixed(2)} ريال
              </Badge>
              <Button size="sm" variant="outline">
                <Plus className="h-4 w-4 mr-2" />
                إضافة عملية
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">جاري التحميل...</div>
          ) : operations.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              لا توجد عمليات
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>التسلسل</TableHead>
                  <TableHead>كود العملية</TableHead>
                  <TableHead>اسم العملية</TableHead>
                  <TableHead>وقت الإعداد</TableHead>
                  <TableHead>وقت التشغيل</TableHead>
                  <TableHead>تكلفة الإعداد</TableHead>
                  <TableHead>تكلفة التشغيل</TableHead>
                  <TableHead>الإجمالي</TableHead>
                  <TableHead>الإجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {operations.map((op) => {
                  const cost = routingCosts.find(c => c.operation_sequence === op.operation_sequence)
                  return (
                    <TableRow key={op.id}>
                      <TableCell>{op.operation_sequence}</TableCell>
                      <TableCell className="font-medium">{op.operation_code}</TableCell>
                      <TableCell>{op.operation_name}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Clock className="h-4 w-4 text-muted-foreground" />
                          {op.setup_time_minutes} دقيقة
                        </div>
                      </TableCell>
                      <TableCell>
                        {op.run_time_minutes} دقيقة/وحدة
                      </TableCell>
                      <TableCell>{cost?.setup_cost.toFixed(2) || '0.00'} ريال</TableCell>
                      <TableCell>{cost?.run_cost.toFixed(2) || '0.00'} ريال</TableCell>
                      <TableCell className="font-bold">
                        {cost?.total_cost.toFixed(2) || '0.00'} ريال
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Button size="sm" variant="ghost">
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button size="sm" variant="ghost">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

