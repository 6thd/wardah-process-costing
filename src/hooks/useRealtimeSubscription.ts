// src/hooks/useRealtimeSubscription.ts
// Realtime subscription hook for Supabase

import { useEffect, useRef, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export const useRealtimeSubscription = (tableName: string, queryKey: string | string[]) => {
  const queryClient = useQueryClient()
  // Memoize key to prevent unnecessary re-renders
  const key = useMemo(() => Array.isArray(queryKey) ? queryKey : [queryKey], [queryKey])
  const channelRef = useRef<any>(null)

  useEffect(() => {
    if (!supabase) return

    // Clean up previous channel if exists
    if (channelRef.current) {
      void (async () => {
        try {
          await supabase.removeChannel(channelRef.current)
        } catch (error) {
          // Ignore errors when removing channel (it might already be closed)
          console.debug('Channel already removed or closed')
        }
      })()
    }

    const channel = supabase
      .channel(`wardah-${tableName}-${Date.now()}`) // Add timestamp to avoid conflicts
      .on('postgres_changes', 
        { event: '*', schema: 'public', table: tableName },
        (payload) => {
          console.log('Realtime update:', payload)
          queryClient.invalidateQueries({ queryKey: key })
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log(`✅ Subscribed to ${tableName} changes`)
        } else if (status === 'CHANNEL_ERROR') {
          console.warn(`⚠️ Channel error for ${tableName}`)
        }
      })

    channelRef.current = channel

    return () => {
      if (channelRef.current && supabase) {
        // Use void to explicitly ignore promise result
        void (async () => {
          try {
            // Always attempt to remove the channel - Supabase handles cleanup gracefully
            await supabase.removeChannel(channelRef.current)
          } catch (error) {
            // Ignore errors - channel might already be closed
            console.debug('Error removing channel (likely already closed):', error)
          }
          channelRef.current = null
        })()
      }
    }
  }, [tableName, key, queryClient])
}