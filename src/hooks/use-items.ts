import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { itemsService } from '../services/supabase-service'
import type { Item } from '../lib/supabase'
import { useAuthStore } from '../store/auth-store'

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
    enabled: !!id,
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
  const { user } = useAuthStore()
  
  return useMutation({
    mutationFn: ({ 
      itemId, 
      quantity, 
      movementType, 
      notes 
    }: { 
      itemId: string
      quantity: number
      movementType: 'in' | 'out' | 'adjustment'
      notes?: string 
    }) => itemsService.updateStock(itemId, quantity, movementType, user?.id || '', notes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items'] })
      queryClient.invalidateQueries({ queryKey: ['stock-movements'] })
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