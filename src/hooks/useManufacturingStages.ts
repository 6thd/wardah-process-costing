import { useQuery } from '@tanstack/react-query'
import { manufacturingStagesService } from '@/services/supabase-service'

export function useManufacturingStages() {
  return useQuery({
    queryKey: ['manufacturing-stages'],
    queryFn: () => manufacturingStagesService.getAll(),
    staleTime: 1000 * 60 * 5, // 5 minutes
    gcTime: 1000 * 60 * 10, // 10 minutes
    refetchOnWindowFocus: false,
    refetchOnMount: true
  })
}

