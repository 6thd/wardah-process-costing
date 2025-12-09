import { supabase } from './supabase'
import { getTableName } from './config'

// Supabase realtime payload types
interface PostgresChangesPayload {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE'
  new: Record<string, any> | null
  old: Record<string, any> | null
  schema: string
  table: string
  commit_timestamp: string
}

interface RealtimeChangePayload {
  table: string
  originalTable: string
  event: string
  record: Record<string, any> | null
  payload: PostgresChangesPayload
}

interface ManufacturingOrderChangePayload {
  type: 'stage_cost' | 'labor_time' | 'moh_applied'
  payload: PostgresChangesPayload
}

type RealtimeCallback = (payload: RealtimeChangePayload | ManufacturingOrderChangePayload) => void

interface RealtimeSubscription {
  id: string
  channel: ReturnType<NonNullable<typeof supabase>['channel']>
  callback: RealtimeCallback
}

class RealtimeManager {
  private subscriptions: Map<string, RealtimeSubscription> = new Map()
  private isConnected = false

  /**
   * Subscribe to changes on specific tables
   */
  subscribeTables(tables: string[], onChange: RealtimeCallback): string {
    // Use crypto API for secure subscription ID
    let subscriptionId: string;
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      subscriptionId = crypto.randomUUID();
    } else if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const array = new Uint8Array(9);
      crypto.getRandomValues(array);
      subscriptionId = Array.from(array, byte => byte.toString(36)).join('').substr(0, 9);
    } else {
      // Fallback
      subscriptionId = Math.random().toString(36).substr(2, 9);
    }
    
    // Create a single channel for multiple tables
    if (!supabase) throw new Error('Supabase client not initialized')
    const channel = supabase.channel(`realtime-${subscriptionId}`)
    
    // Add listeners for each table
    tables.forEach(table => {
      const tableName = getTableName(table)
      channel.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: tableName
        },
        (payload: PostgresChangesPayload) => {
          console.log(`🔄 Realtime change detected in ${tableName}:`, payload)
          onChange({
            table: tableName,
            originalTable: table,
            event: payload.eventType,
            record: payload.new || payload.old,
            payload
          })
        }
      )
    })

    // Subscribe to the channel
    channel.subscribe((status: string) => {
      console.log(`📡 Realtime status for ${subscriptionId}:`, status)
      this.isConnected = status === 'SUBSCRIBED'
    })

    // Store subscription
    this.subscriptions.set(subscriptionId, {
      id: subscriptionId,
      channel,
      callback: onChange
    })

    return subscriptionId
  }

  /**
   * Subscribe to a specific manufacturing order's changes
   */
  subscribeManufacturingOrder(moId: string, onChange: RealtimeCallback): string {
    // Use crypto API for secure subscription ID
    let subscriptionId: string;
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      subscriptionId = crypto.randomUUID();
    } else if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const array = new Uint8Array(9);
      crypto.getRandomValues(array);
      subscriptionId = Array.from(array, byte => byte.toString(36)).join('').substr(0, 9);
    } else {
      // Fallback
      subscriptionId = Math.random().toString(36).substr(2, 9);
    }
    
    if (!supabase) throw new Error('Supabase client not initialized')
    const channel = supabase.channel(`mo-${moId}-${subscriptionId}`)
    
    // Listen to stage costs changes
    channel.on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: getTableName('stage_costs'),
        filter: `manufacturing_order_id=eq.${moId}`
      },
      (payload: PostgresChangesPayload) => onChange({ type: 'stage_cost', payload })
    )

    // Listen to labor time logs changes
    channel.on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: getTableName('labor_time_logs'),
        filter: `manufacturing_order_id=eq.${moId}`
      },
      (payload: PostgresChangesPayload) => onChange({ type: 'labor_time', payload })
    )

    // Listen to MOH applied changes
    channel.on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: getTableName('moh_applied'),
        filter: `manufacturing_order_id=eq.${moId}`
      },
      (payload: PostgresChangesPayload) => onChange({ type: 'moh_applied', payload })
    )

    channel.subscribe()
    
    this.subscriptions.set(subscriptionId, {
      id: subscriptionId,
      channel,
      callback: onChange
    })

    return subscriptionId
  }

  /**
   * Unsubscribe from a specific subscription
   */
  unsubscribe(subscriptionId: string): void {
    const subscription = this.subscriptions.get(subscriptionId)
    if (subscription) {
      subscription.channel.unsubscribe()
      this.subscriptions.delete(subscriptionId)
      console.log(`🔌 Unsubscribed from ${subscriptionId}`)
    }
  }

  /**
   * Unsubscribe from all subscriptions
   */
  unsubscribeAll(): void {
    this.subscriptions.forEach(subscription => {
      subscription.channel.unsubscribe()
    })
    this.subscriptions.clear()
    this.isConnected = false
    console.log('🔌 Unsubscribed from all realtime channels')
  }

  /**
   * Get connection status
   */
  getConnectionStatus(): boolean {
    return this.isConnected
  }

  /**
   * Get active subscriptions count
   */
  getActiveSubscriptionsCount(): number {
    return this.subscriptions.size
  }

  /**
   * Update connection status indicator in UI
   */
  updateStatusIndicator(): void {
    const indicator = document.getElementById('connectionStatus')
    if (indicator) {
      const count = this.getActiveSubscriptionsCount()
      const status = this.getConnectionStatus()
      
      if (status && count > 0) {
        indicator.textContent = `🟢 متصل (${count})`
        indicator.className = 'text-sm text-green-600 dark:text-green-400'
      } else if (count > 0) {
        indicator.textContent = `🟡 يتصل... (${count})`
        indicator.className = 'text-sm text-yellow-600 dark:text-yellow-400'
      } else {
        indicator.textContent = '⚪ غير متصل'
        indicator.className = 'text-sm text-gray-600 dark:text-gray-400'
      }
    }
  }
}

// Export singleton instance
export const realtimeManager = new RealtimeManager()

// Auto-update status indicator
setInterval(() => {
  realtimeManager.updateStatusIndicator()
}, 2000)

// Cleanup on page unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    realtimeManager.unsubscribeAll()
  })
}

export default realtimeManager