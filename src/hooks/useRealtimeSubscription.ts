// src/hooks/useRealtimeSubscription.ts
// Realtime subscription hook for Supabase

import { useEffect, useRef, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export const useRealtimeSubscription = (
  tableName: string,
  queryKey: string | string[],
  options?: { enabled?: boolean }
) => {
  const queryClient = useQueryClient()
  // Memoize key to prevent unnecessary re-renders
  const key = useMemo(() => Array.isArray(queryKey) ? queryKey : [queryKey], [queryKey])
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const enabled = options?.enabled ?? true

  useEffect(() => {
    if (!supabase) return

    // No read permission for this resource: do not open a realtime channel.
    // Also tears down any channel left over from a permission that was just
    // revoked, instead of leaving it streaming updates for data the UI no
    // longer has the right to display.
    if (!enabled) {
      if (channelRef.current) {
        const staleChannel = channelRef.current
        channelRef.current = null
        void (async () => {
          try {
            await supabase.removeChannel(staleChannel)
          } catch {
            // Ignore errors when removing channel (it might already be closed)
          }
        })()
      }
      return
    }

    // Clean up previous channel if exists
    if (channelRef.current) {
      void (async () => {
        try {
          await supabase.removeChannel(channelRef.current)
        } catch {
          // Ignore errors when removing channel (it might already be closed)
        }
      })()
    }

    const channel = supabase
      .channel(`wardah-${tableName}-${Date.now()}`) // Add timestamp to avoid conflicts
      .on('postgres_changes', 
        { event: '*', schema: 'public', table: tableName },
        () => {
          queryClient.invalidateQueries({ queryKey: key })
        }
      )
      .subscribe()

    channelRef.current = channel

    return () => {
      if (channelRef.current && supabase) {
        // Use void to explicitly ignore promise result
        void (async () => {
          try {
            // Always attempt to remove the channel - Supabase handles cleanup gracefully
            await supabase.removeChannel(channelRef.current)
          } catch {
            // Ignore errors - channel might already be closed
          }
          channelRef.current = null
        })()
      }
    }
  }, [tableName, key, queryClient, enabled])
}