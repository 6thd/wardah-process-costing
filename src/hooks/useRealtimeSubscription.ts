// src/hooks/useRealtimeSubscription.ts
// Realtime subscription hook for Supabase

import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export const useRealtimeSubscription = (tableName: string, queryKey: string | string[]) => {
  const queryClient = useQueryClient()
  const key = Array.isArray(queryKey) ? queryKey : [queryKey]

  useEffect(() => {
    if (!supabase) return

    const channel = supabase
      .channel(`wardah-${tableName}`)
      .on('postgres_changes', 
        { event: '*', schema: 'public', table: tableName },
        (payload) => {
          console.log('Realtime update:', payload)
          queryClient.invalidateQueries({ queryKey: key })
        }
      )
      .subscribe()

    return () => {
      if (supabase) {
        supabase.removeChannel(channel)
      }
    }
  }, [tableName, key, queryClient])
}