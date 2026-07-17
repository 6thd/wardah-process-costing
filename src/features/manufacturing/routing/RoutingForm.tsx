/**
 * Routing Form - نموذج إضافة/تعديل مسار التصنيع
 */

import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ArrowLeft, Save } from 'lucide-react'
import { useRouting, useCreateRouting, useUpdateRouting } from '@/hooks/manufacturing/useRouting'
import { getEffectiveTenantId } from '@/lib/supabase'
import { RoutingFormData } from '@/services/manufacturing/routingService'
import { toast } from 'sonner'

// eslint-disable-next-line complexity
export function RoutingForm() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'
  const isEditMode = !!id

  const [orgId, setOrgId] = useState<string>('')
  const [formData, setFormData] = useState<RoutingFormData>({
    routing_code: '',
    routing_name: '',
    routing_name_ar: '',
    description: '',
    description_ar: '',
    status: 'DRAFT',
    is_active: true,
    effective_date: new Date().toISOString().split('T')[0],
  })

  const { data: routing, isLoading } = useRouting(id || '')
  const createRouting = useCreateRouting(orgId || undefined)
  const updateRouting = useUpdateRouting()

  useEffect(() => {
    const loadOrgId = async () => {
      const id = await getEffectiveTenantId()
      setOrgId(id || '')
    }
    loadOrgId()
  }, [])

  useEffect(() => {
    if (routing && isEditMode) {
      setFormData({
        routing_code: routing.routing_code,
        routing_name: routing.routing_name,
        routing_name_ar: routing.routing_name_ar || '',
        description: routing.description || '',
        description_ar: routing.description_ar || '',
        status: routing.status,
        is_active: routing.is_active,
        effective_date: routing.effective_date,
        expiry_date: routing.expiry_date || undefined,
        item_id: routing.item_id || undefined,
      })
    }
  }, [routing, isEditMode])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.routing_code || !formData.routing_name) {
      toast.error(t('routingForm.validationError'))
      return
    }

    try {
      if (isEditMode && id) {
        await updateRouting.mutateAsync({ id, data: formData })
        toast.success(t('routingForm.updateSuccess'))
      } else {
        await createRouting.mutateAsync(formData)
        toast.success(t('routingForm.createSuccess'))
      }
      navigate('/manufacturing/routing')
    } catch (error) {
      const err = error as { message?: string }
      toast.error(err.message || t('routingForm.error'))
    }
  }

  if (isEditMode && isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="mt-2 text-muted-foreground">{t('routingForm.loading')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className={`space-y-6 p-6 ${isRTL ? 'rtl' : 'ltr'}`}>
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" onClick={() => navigate('/manufacturing/routing')}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          {t('routingForm.back')}
        </Button>
        <h1 className="text-3xl font-bold wardah-text-gradient-google">
          {isEditMode ? t('routingForm.editTitle') : t('routingForm.newTitle')}
        </h1>
      </div>

      {/* Form */}
      <Card className="wardah-glass-card">
        <CardHeader>
          <CardTitle>{t('routingForm.cardTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="routing_code">
                  {t('routingForm.code')} *
                </Label>
                <Input
                  id="routing_code"
                  value={formData.routing_code}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, routing_code: e.target.value }))
                  }
                  required
                  disabled={isEditMode}
                />
              </div>

              <div>
                <Label htmlFor="routing_name">
                  {t('routingForm.nameEn')} *
                </Label>
                <Input
                  id="routing_name"
                  value={formData.routing_name}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, routing_name: e.target.value }))
                  }
                  required
                />
              </div>

              <div>
                <Label htmlFor="routing_name_ar">
                  {t('routingForm.nameAr')}
                </Label>
                <Input
                  id="routing_name_ar"
                  value={formData.routing_name_ar || ''}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, routing_name_ar: e.target.value }))
                  }
                />
              </div>

              <div>
                <Label htmlFor="status">{t('routingForm.status')}</Label>
                <Select
                  value={formData.status}
                  onValueChange={(value) =>
                    setFormData((prev) => ({
                      ...prev,
                      status: value as 'DRAFT' | 'APPROVED' | 'OBSOLETE',
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DRAFT">{t('routingForm.statusDraft')}</SelectItem>
                    <SelectItem value="APPROVED">{t('routingForm.statusApproved')}</SelectItem>
                    <SelectItem value="OBSOLETE">{t('routingForm.statusObsolete')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="effective_date">
                  {t('routingForm.effectiveDate')}
                </Label>
                <Input
                  id="effective_date"
                  type="date"
                  value={formData.effective_date}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, effective_date: e.target.value }))
                  }
                />
              </div>

              <div>
                <Label htmlFor="expiry_date">
                  {t('routingForm.expiryDate')}
                </Label>
                <Input
                  id="expiry_date"
                  type="date"
                  value={formData.expiry_date || ''}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      expiry_date: e.target.value || undefined,
                    }))
                  }
                />
              </div>
            </div>

            <div>
              <Label htmlFor="description">
                {t('routingForm.descEn')}
              </Label>
              <Textarea
                id="description"
                value={formData.description || ''}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, description: e.target.value }))
                }
                rows={3}
              />
            </div>

            <div>
              <Label htmlFor="description_ar">
                {t('routingForm.descAr')}
              </Label>
              <Textarea
                id="description_ar"
                value={formData.description_ar || ''}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, description_ar: e.target.value }))
                }
                rows={3}
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is_active"
                checked={formData.is_active}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, is_active: e.target.checked }))
                }
                className="h-4 w-4"
              />
              <Label htmlFor="is_active" className="cursor-pointer">
                {t('routingForm.active')}
              </Label>
            </div>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate('/manufacturing/routing')}
              >
                {t('routingForm.cancel')}
              </Button>
              <Button
                type="submit"
                disabled={createRouting.isPending || updateRouting.isPending}
              >
                <Save className="w-4 h-4 mr-2" />
                {createRouting.isPending || updateRouting.isPending ? t('routingForm.saving') : t('routingForm.save')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

