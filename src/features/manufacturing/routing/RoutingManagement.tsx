/**
 * Routing Management - إدارة مسارات التصنيع
 */

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Plus,
  Search,
  Edit,
  Trash2,
  Copy,
  CheckCircle,
  RefreshCw,
  Route,
  Settings
} from 'lucide-react'
import { useRoutings, useDeleteRouting, useApproveRouting, useCopyRouting } from '@/hooks/manufacturing/useRouting'
import { useAuthStore } from '@/store/auth-store'
import { getEffectiveTenantId } from '@/lib/supabase'
import { Routing } from '@/services/manufacturing/routingService'
import { RoutingTable } from './components/RoutingTable'
import { RoutingStats } from './components/RoutingStats'
import { RoutingEmptyState } from './components/RoutingEmptyState'

export function RoutingManagement() {
  const navigate = useNavigate()
  const { i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'
  const { user } = useAuthStore()
  const [orgId, setOrgId] = useState<string>('')
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'DRAFT' | 'APPROVED' | 'OBSOLETE'>('ALL')

  useEffect(() => {
    const loadOrgId = async () => {
      const id = await getEffectiveTenantId() // 't' removed as unused
      setOrgId(id || '')
    }
    loadOrgId()
  }, [])

  const { data: routings, isLoading, refetch } = useRoutings(orgId || undefined)
  const deleteRouting = useDeleteRouting(orgId || undefined)
  const approveRouting = useApproveRouting()
  const copyRouting = useCopyRouting(orgId || undefined)

  // Filter routings
  const filteredRoutings = routings?.filter((routing: Routing) => {
    const matchesSearch = 
      routing.routing_code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      routing.routing_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (routing.routing_name_ar?.toLowerCase().includes(searchTerm.toLowerCase()) ?? false)
    
    const matchesStatus = statusFilter === 'ALL' || routing.status === statusFilter
    
    return matchesSearch && matchesStatus
  })

  const handleEdit = (id: string) => {
    navigate(`/manufacturing/routing/${id}`)
  }

  const handleView = (id: string) => {
    navigate(`/manufacturing/routing/${id}`)
  }

  const handleDelete = async (id: string) => {
    if (confirm(isRTL ? 'هل أنت متأكد من حذف هذا المسار؟' : 'Are you sure you want to delete this routing?')) {
      deleteRouting.mutate(id)
    }
  }

  const handleApprove = async (id: string) => {
    if (user?.id) {
      approveRouting.mutate({ id, userId: user.id })
    }
  }

  const handleCopy = async (id: string, code: string) => {
    const newCode = `${code}-COPY-${Date.now().toString().slice(-4)}`
    copyRouting.mutate({ id, newCode })
  }

  const getStatusBadge = (status: string, isActive: boolean) => {
    if (!isActive) {
      return <Badge variant="secondary">{isRTL ? 'غير نشط' : 'Inactive'}</Badge>
    }
    switch (status) {
      case 'DRAFT':
        return <Badge variant="outline">{isRTL ? 'مسودة' : 'Draft'}</Badge>
      case 'APPROVED':
        return <Badge className="bg-green-500">{isRTL ? 'معتمد' : 'Approved'}</Badge>
      case 'OBSOLETE':
        return <Badge variant="destructive">{isRTL ? 'قديم' : 'Obsolete'}</Badge>
      default:
        return <Badge>{status}</Badge>
    }
  }

  return (
    <div className={`space-y-6 p-6 ${isRTL ? 'rtl' : 'ltr'}`}>
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold wardah-text-gradient-google">
            <Route className="inline-block w-8 h-8 mr-2" />
            {isRTL ? 'مسارات التصنيع' : 'Manufacturing Routings'}
          </h1>
          <p className="text-muted-foreground mt-1">
            {isRTL ? 'إدارة مسارات وعمليات التصنيع' : 'Manage manufacturing routings and operations'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4 mr-2" />
            {isRTL ? 'تحديث' : 'Refresh'}
          </Button>
          <Button onClick={() => navigate('/manufacturing/routing/new')}>
            <Plus className="w-4 h-4 mr-2" />
            {isRTL ? 'مسار جديد' : 'New Routing'}
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <RoutingStats routings={routings} isRTL={isRTL} />

      {/* Filters */}
      <Card className="wardah-glass-card">
        <CardContent className="p-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder={isRTL ? 'البحث في المسارات...' : 'Search routings...'}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder={isRTL ? 'الحالة' : 'Status'} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{isRTL ? 'الكل' : 'All'}</SelectItem>
                <SelectItem value="DRAFT">{isRTL ? 'مسودة' : 'Draft'}</SelectItem>
                <SelectItem value="APPROVED">{isRTL ? 'معتمد' : 'Approved'}</SelectItem>
                <SelectItem value="OBSOLETE">{isRTL ? 'قديم' : 'Obsolete'}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Routings Table */}
      <Card className="wardah-glass-card">
        <CardHeader>
          <CardTitle>{isRTL ? 'قائمة المسارات' : 'Routings List'}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && (
            <div className="flex justify-center items-center h-32">
              <RefreshCw className="w-6 h-6 animate-spin" />
              <span className="ml-2">{isRTL ? 'جاري التحميل...' : 'Loading...'}</span>
            </div>
          )}
          {!isLoading && (!filteredRoutings || filteredRoutings.length === 0) && (
            <RoutingEmptyState
              isRTL={isRTL}
              onCreateNew={() => navigate('/manufacturing/routing/new')}
            />
          )}
          {!isLoading && filteredRoutings && filteredRoutings.length > 0 && (
            <RoutingTable
              routings={filteredRoutings}
              isRTL={isRTL}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onCopy={handleCopy}
              onApprove={handleApprove}
              onView={handleView}
              getStatusBadge={getStatusBadge}
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default RoutingManagement

