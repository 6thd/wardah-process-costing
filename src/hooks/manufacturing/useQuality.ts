/**
 * React Query hooks for manufacturing quality control (Migration 199).
 * Keys carry the org id so an organization switch never shows the previous
 * organization's policy or inspections.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import {
  qualityService,
  type QualityHoldAction,
  type QualityPolicySettings,
  type RecordInspectionInput,
} from '@/services/manufacturing/qualityService'

export const qualityKeys = {
  all: ['manufacturing-quality'] as const,
  policy: (orgId: string | null) => [...qualityKeys.all, 'policy', orgId] as const,
  inspections: (orgId: string | null, moId?: string | null) =>
    [...qualityKeys.all, 'inspections', orgId, moId ?? null] as const,
  moStatus: (moId: string | null) => [...qualityKeys.all, 'mo-status', moId] as const,
}

export function useQualityPolicy(options?: { enabled?: boolean }) {
  const { currentOrgId } = useAuth()
  return useQuery({
    queryKey: qualityKeys.policy(currentOrgId),
    queryFn: () => qualityService.getQualityPolicy(currentOrgId as string),
    enabled: Boolean(currentOrgId) && (options?.enabled ?? true),
  })
}

export function useSaveQualityPolicy() {
  const { currentOrgId } = useAuth()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ settings, expectedVersion }: {
      settings: QualityPolicySettings
      expectedVersion: number
    }) => {
      if (!currentOrgId) throw new Error('ORG_UNRESOLVED')
      return qualityService.setQualityPolicy(currentOrgId, settings, expectedVersion)
    },
    onSuccess: (policy) => {
      queryClient.setQueryData(qualityKeys.policy(currentOrgId), policy)
      // Release readiness depends on the policy.
      return queryClient.invalidateQueries({ queryKey: [...qualityKeys.all, 'mo-status'] })
    },
  })
}

export function useQualityInspections(moId?: string | null, options?: { enabled?: boolean }) {
  const { currentOrgId } = useAuth()
  return useQuery({
    queryKey: qualityKeys.inspections(currentOrgId, moId),
    queryFn: () => qualityService.listQualityInspections(currentOrgId as string, moId),
    enabled: Boolean(currentOrgId) && (options?.enabled ?? true),
  })
}

export function useMoQualityStatus(moId: string | null, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: qualityKeys.moStatus(moId),
    queryFn: () => qualityService.getMoQualityStatus(moId as string),
    enabled: Boolean(moId) && (options?.enabled ?? true),
  })
}

function useInvalidateQuality() {
  const queryClient = useQueryClient()
  return () => Promise.all([
    queryClient.invalidateQueries({ queryKey: qualityKeys.all }),
    queryClient.invalidateQueries({ queryKey: ['manufacturing-quality-queue'] }),
  ])
}

export function useRecordQualityInspection() {
  const invalidate = useInvalidateQuality()
  return useMutation({
    mutationFn: ({ moId, requestId, input }: {
      moId: string
      requestId: string
      input: RecordInspectionInput
    }) => qualityService.recordQualityInspection(moId, requestId, input),
    onSuccess: invalidate,
  })
}

export function useSetMoQualityHold() {
  const invalidate = useInvalidateQuality()
  return useMutation({
    mutationFn: ({ moId, action, expectedVersion, reason }: {
      moId: string
      action: QualityHoldAction
      expectedVersion: number
      reason?: string
    }) => qualityService.setMoQualityHold(moId, action, expectedVersion, reason),
    onSuccess: invalidate,
  })
}
