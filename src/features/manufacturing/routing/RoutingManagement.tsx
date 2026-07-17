/**
 * Routing Management - إدارة مسارات التصنيع
 */

import { useState, useEffect } from 'react'
import { useNavigate, Routes, Route } from 'react-router-dom'
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
  RefreshCw,
  Route as RouteIcon
} from 'lucide-react'
import { useRoutings, useDeleteRouting, useApproveRouting, useCopyRouting } from '@/hooks/manufacturing/useRouting'
import { useAuthStore } from '@/store/auth-store'
import { getEffectiveTenantId } from '@/lib/supabase'
import { Routing } from '@/services/manufacturing/routingService'
import { RoutingTable } from './components/RoutingTable'
import { RoutingStats } from './components/RoutingStats'
import { RoutingEmptyState } from './components/RoutingEmptyState'
import { RoutingForm } from './RoutingForm'

function RoutingList() {
  const navigate = useNavigate()
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'
  const { user } = useAuthStore()
  const [orgId, setOrgId] = useState<string>('')
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'DRAFT' | 'APPROVED' | 'OBSOLETE'>('ALL')

  useEffect(() => {
    const loadOrgId = async () => {
      const id = await getEffectiveTenantId()
      setOrgId(id || '')
    }
    loadOrgId()
  }, [])

  const { data: routings, isLoading, refetch } = useRoutings(orgId || undefined)
  const deleteRouting = useDeleteRouting(orgId || undefined)
  const approveRouting = useApproveRouting()
  const copyRouting = useCopyRouting(orgId || undefined)

  // Helper functions to reduce cognitive complexity
  const matchesSearchTerm = (routing: Routing, term: string): boolean => {
    const lowerTerm = term.toLowerCase()
    return routing.routing_code.toLowerCase().includes(lowerTerm) ||
      routing.routing_name.toLowerCase().includes(lowerTerm) ||
      (routing.routing_name_ar?.toLowerCase().includes(lowerTerm) ?? false)
  }

  const matchesStatusFilter = (routing: Routing): boolean => {
    return statusFilter === 'ALL' || routing.status === statusFilter
  }

  // Filter routings
  const filteredRoutings = routings?.filter((routing: Routing) => {
    return matchesSearchTerm(routing, searchTerm) && matchesStatusFilter(routing)
  }) ?? []

  const handleEdit = (id: string) => {
    navigate(`/manufacturing/routing/${id}`)
  }

  const handleView = (id: string) => {
    navigate(`/manufacturing/routing/${id}`)
  }

  const handleDelete = async (id: string) => {
    if (confirm(t('routingMgmt.deleteConfirm'))) {
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
      return <Badge variant="secondary">{t('routingMgmt.inactive')}</Badge>
    }
    switch (status) {
      case 'DRAFT':
        return <Badge variant="outline">{t('routingMgmt.draft')}</Badge>
      case 'APPROVED':
        return <Badge className="bg-green-500">{t('routingMgmt.approved')}</Badge>
      case 'OBSOLETE':
        return <Badge variant="destructive">{t('routingMgmt.obsolete')}</Badge>
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
            <RouteIcon className="inline-block w-8 h-8 mr-2" />
            {t('routingMgmt.title')}
          </h1>
          <p className="text-muted-foreground mt-1">
            {t('routingMgmt.subtitle')}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4 mr-2" />
            {t('routingMgmt.refresh')}
          </Button>
          <Button onClick={() => navigate('/manufacturing/routing/new')}>
            <Plus className="w-4 h-4 mr-2" />
            {t('routingMgmt.newRouting')}
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <RoutingStats routings={routings} />

      {/* Filters */}
      <Card className="wardah-glass-card">
        <CardContent className="p-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder={t('routingMgmt.searchPlaceholder')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder={t('routingMgmt.status')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{t('routingMgmt.all')}</SelectItem>
                <SelectItem value="DRAFT">{t('routingMgmt.draft')}</SelectItem>
                <SelectItem value="APPROVED">{t('routingMgmt.approved')}</SelectItem>
                <SelectItem value="OBSOLETE">{t('routingMgmt.obsolete')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Routings Table */}
      <Card className="wardah-glass-card">
        <CardHeader>
          <CardTitle>{t('routingMgmt.listTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && (
            <div className="flex justify-center items-center h-32">
              <RefreshCw className="w-6 h-6 animate-spin" />
              <span className="ml-2">{t('routingMgmt.loading')}</span>
            </div>
          )}
          {!isLoading && (!filteredRoutings || filteredRoutings.length === 0) && (
            <RoutingEmptyState
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

export function RoutingManagement() {
  return (
    <Routes>
      <Route index element={<RoutingList />} />
      <Route path="new" element={<RoutingForm />} />
      <Route path=":id" element={<RoutingForm />} />
    </Routes>
  )
}

export default RoutingManagement

