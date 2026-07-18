import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { itemsService } from '../services/supabase-service'
import { manualStockMovementService } from '../services/manual-stock-movement-service'
import type { Item } from '../lib/supabase'

export function useItems() {
  return useQuery({
    queryKey: ['items'],
    queryFn: itemsService.getAll,
  })
}

export function useLowStockItems() {
  return useQuery({
    queryKey: ['items', 'low-stock'],
    queryFn: itemsService.getLowStock,
  })
}

export function useItem(id: string) {
  return useQuery({
    queryKey: ['items', id],
    queryFn: () => itemsService.getById(id),
    enabled: Boolean(id),
  })
}

export function useCreateItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (item: Omit<Item, 'id' | 'created_at' | 'updated_at'>) =>
      itemsService.create(item),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items'] })
    },
  })
}

export function useUpdateItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, ...item }: { id: string } & Partial<Item>) =>
      itemsService.update(id, item),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items'] })
    },
  })
}

export function useUpdateStock() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      itemId,
      quantity,
      movementType,
      warehouseId,
      notes,
    }: {
      itemId: string
      quantity: number
      movementType: 'in' | 'out' | 'adjustment'
      warehouseId?: string
      notes?: string
    }) =>
      manualStockMovementService.apply({
        productId: itemId,
        quantity,
        movementType,
        warehouseId,
        notes,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items'] })
      queryClient.invalidateQueries({ queryKey: ['stock-movements'] })
      queryClient.invalidateQueries({ queryKey: ['stock-ledger'] })
      queryClient.invalidateQueries({ queryKey: ['bins'] })
    },
  })
}

export function useDeleteItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: itemsService.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items'] })
    },
  })
}
