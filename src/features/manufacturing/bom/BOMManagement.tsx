/**
 * BOM Management Dashboard
 * لوحة إدارة قوائم المواد
 */

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { 
  Plus, 
  Search, 
  Edit, 
  Trash2, 
  Copy, 
  CheckCircle, 
  FileText,
  TrendingUp
} from 'lucide-react'
import { useBOMs, useDeleteBOM, useApproveBOM, useCopyBOM } from '@/hooks/manufacturing/useBOM'
import { useAuthStore } from '@/store/auth-store'
import { BOMHeader } from '@/services/manufacturing/bomService'
import { getEffectiveTenantId } from '@/lib/supabase'

export function BOMManagement() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const [orgId, setOrgId] = useState<string>('')

  useEffect(() => {
    const loadOrgId = async () => {
      const id = await getEffectiveTenantId()
      setOrgId(id || '')
    }
    loadOrgId()
  }, [])
  
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'DRAFT' | 'APPROVED' | 'OBSOLETE'>('ALL')

  // Queries and mutations
  const { data: boms, isLoading } = useBOMs(orgId || undefined)
  const deleteBOM = useDeleteBOM(orgId || undefined)
  const approveBOM = useApproveBOM(orgId || undefined, user?.id || '')
  const copyBOM = useCopyBOM(orgId || undefined)

  // Filter BOMs
  const filteredBOMs = boms?.filter(bom => {
    const matchesSearch = 
      bom.bom_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      bom.item_code?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      bom.description?.toLowerCase().includes(searchTerm.toLowerCase())
    
    const matchesStatus = statusFilter === 'ALL' || bom.status === statusFilter
    
    return matchesSearch && matchesStatus
  })

  // Handle actions
  const handleEdit = (bomId: string) => {
    navigate(`/manufacturing/bom/${bomId}/edit`)
  }

  const handleDelete = async (bomId: string) => {
    if (confirm('هل أنت متأكد من حذف قائمة المواد هذه؟')) {
      await deleteBOM.mutateAsync(bomId)
    }
  }

  const handleApprove = async (bomId: string) => {
    if (confirm('هل تريد اعتماد قائمة المواد هذه؟')) {
      await approveBOM.mutateAsync(bomId)
    }
  }

  const handleCopy = async (bomId: string, oldNumber: string) => {
    const newNumber = prompt('أدخل رقم القائمة الجديد:', `${oldNumber}-COPY`)
    if (newNumber) {
      await copyBOM.mutateAsync({
        sourceBomId: bomId,
        newBomNumber: newNumber
      })
    }
  }

  const handleView = (bomId: string) => {
    navigate(`/manufacturing/bom/${bomId}`)
  }

  // Get status badge
  const getStatusBadge = (status: string, isActive: boolean) => {
    if (!isActive) {
      return <Badge variant="secondary">غير نشط</Badge>
    }
    
    switch (status) {
      case 'DRAFT':
        return <Badge variant="secondary">مسودة</Badge>
      case 'APPROVED':
        return <Badge className="bg-green-600">معتمد</Badge>
      case 'OBSOLETE':
        return <Badge variant="destructive">ملغى</Badge>
      default:
        return <Badge>{status}</Badge>
    }
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold wardah-text-gradient-google">
            إدارة قوائم المواد
          </h1>
          <p className="text-muted-foreground mt-1">
            Bill of Materials Management
          </p>
        </div>
        <Button onClick={() => navigate('/manufacturing/bom/new')}>
          <Plus className="w-4 h-4 mr-2" />
          قائمة جديدة
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid md:grid-cols-4 gap-4">
        <Card className="wardah-glass-card">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">إجمالي القوائم</p>
                <p className="text-2xl font-bold">{boms?.length || 0}</p>
              </div>
              <FileText className="w-8 h-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>

        <Card className="wardah-glass-card">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">معتمد</p>
                <p className="text-2xl font-bold text-green-600">
                  {boms?.filter(b => b.status === 'APPROVED').length || 0}
                </p>
              </div>
              <CheckCircle className="w-8 h-8 text-green-600" />
            </div>
          </CardContent>
        </Card>

        <Card className="wardah-glass-card">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">مسودات</p>
                <p className="text-2xl font-bold text-orange-600">
                  {boms?.filter(b => b.status === 'DRAFT').length || 0}
                </p>
              </div>
              <Edit className="w-8 h-8 text-orange-600" />
            </div>
          </CardContent>
        </Card>

        <Card className="wardah-glass-card">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">نشط</p>
                <p className="text-2xl font-bold text-blue-600">
                  {boms?.filter(b => b.is_active).length || 0}
                </p>
              </div>
              <TrendingUp className="w-8 h-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="wardah-glass-card">
        <CardContent className="p-4">
          <div className="flex gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute right-3 top-3 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="بحث برقم القائمة أو رمز الصنف..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pr-10"
                />
              </div>
            </div>
            
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="px-4 py-2 border rounded-md"
            >
              <option value="ALL">كل الحالات</option>
              <option value="DRAFT">مسودة</option>
              <option value="APPROVED">معتمد</option>
              <option value="OBSOLETE">ملغى</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {/* BOMs Table */}
      <Card className="wardah-glass-card">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">جاري التحميل...</p>
            </div>
          ) : filteredBOMs?.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">لا توجد قوائم مواد</p>
              <Button
                className="mt-4"
                onClick={() => navigate('/manufacturing/bom/new')}
              >
                إنشاء قائمة جديدة
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-right p-4 font-medium">رقم القائمة</th>
                    <th className="text-right p-4 font-medium">رمز الصنف</th>
                    <th className="text-right p-4 font-medium">اسم الصنف</th>
                    <th className="text-right p-4 font-medium">الإصدار</th>
                    <th className="text-right p-4 font-medium">الحالة</th>
                    <th className="text-right p-4 font-medium">التكلفة</th>
                    <th className="text-right p-4 font-medium">تاريخ السريان</th>
                    <th className="text-center p-4 font-medium">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredBOMs?.map((bom: BOMHeader) => (
                    <tr
                      key={bom.id}
                      className="border-t hover:bg-muted/30 cursor-pointer"
                      onClick={() => handleView(bom.id!)}
                    >
                      <td className="p-4 font-medium">{bom.bom_number}</td>
                      <td className="p-4">{bom.item_code || '-'}</td>
                      <td className="p-4">{bom.item_name || '-'}</td>
                      <td className="p-4">
                        <Badge variant="outline">v{bom.bom_version}</Badge>
                      </td>
                      <td className="p-4">
                        {getStatusBadge(bom.status, bom.is_active)}
                      </td>
                      <td className="p-4">{bom.unit_cost.toFixed(2)} ر.س</td>
                      <td className="p-4 text-sm text-muted-foreground">
                        {new Date(bom.effective_date).toLocaleDateString('ar-SA')}
                      </td>
                      <td className="p-4">
                        <div className="flex items-center justify-center gap-2" onMouseDown={(e) => e.stopPropagation()}>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleEdit(bom.id!)}
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                          
                          {bom.status === 'DRAFT' && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleApprove(bom.id!)}
                              className="text-green-600"
                            >
                              <CheckCircle className="w-4 h-4" />
                            </Button>
                          )}
                          
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleCopy(bom.id!, bom.bom_number)}
                          >
                            <Copy className="w-4 h-4" />
                          </Button>
                          
                          {bom.status === 'DRAFT' && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleDelete(bom.id!)}
                              className="text-red-600"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
