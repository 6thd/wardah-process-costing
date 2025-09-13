import { supabase } from '@/lib/supabase'
import { PostingService } from './posting-service'

/**
 * Interface for variance analysis results
 */
export interface VarianceAnalysis {
  moId: string
  stageNo: number
  materialVariance: number
  laborVariance: number
  overheadVariance: number
  totalVariance: number
  variancePercentage: number
  severity: 'LOW' | 'MEDIUM' | 'HIGH'
}

/**
 * Interface for overhead variance analysis
 */
export interface OverheadVariance {
  workCenterId: string
  appliedOH: number
  actualOH: number
  variance: number
  variancePercentage: number
  severity: 'LOW' | 'MEDIUM' | 'HIGH'
}

/**
 * Variance Monitoring Service
 * Handles scheduled variance analysis and monitoring
 */
export class VarianceMonitoringService {
  /**
   * Perform variance analysis for a manufacturing order stage
   */
  static async performVarianceAnalysis(moId: string, stageNo: number): Promise<VarianceAnalysis> {
    const { data, error } = await supabase.rpc('perform_variance_analysis', {
      p_mo_id: moId,
      p_stage_no: stageNo
    })

    if (error) throw new Error(error.message)
    return data as VarianceAnalysis
  }

  /**
   * Get variance alerts based on severity threshold
   */
  static async getVarianceAlerts(severityThreshold: 'LOW' | 'MEDIUM' | 'HIGH' = 'MEDIUM'): Promise<VarianceAnalysis[]> {
    const { data, error } = await supabase.rpc('get_variance_alerts', {
      p_severity_threshold: severityThreshold
    })

    if (error) throw new Error(error.message)
    return data as VarianceAnalysis[]
  }

  /**
   * Analyze overhead variances for work centers
   */
  static async analyzeOverheadVariances(): Promise<OverheadVariance[]> {
    const { data, error } = await supabase.rpc('analyze_overhead_variances')

    if (error) throw new Error(error.message)
    return data as OverheadVariance[]
  }

  /**
   * Generate variance report
   */
  static async generateVarianceReport(
    startDate: string,
    endDate: string,
    moId?: string
  ): Promise<VarianceAnalysis[]> {
    const { data, error } = await supabase.rpc('generate_variance_report', {
      p_start_date: startDate,
      p_end_date: endDate,
      p_mo_id: moId || null
    })

    if (error) throw new Error(error.message)
    return data as VarianceAnalysis[]
  }

  /**
   * Post overhead variance journal entry
   */
  static async postOverheadVarianceJournal(
    variance: OverheadVariance,
    memo: string,
    refId: string
  ): Promise<string> {
    // Calculate the variance amount
    const varianceAmount = Math.abs(variance.variance)

    // Determine if it's under/over applied
    const isUnderApplied = variance.appliedOH < variance.actualOH

    // Post to GL - this would use our posting service
    // In a real implementation, you would map to appropriate accounts
    // For now, we'll use a generic approach
    const journalId = await PostingService.postEventJournal({
      event: isUnderApplied ? 'OH_UNDER_APPLIED' : 'OH_OVER_APPLIED',
      amount: varianceAmount,
      memo: memo,
      refType: 'OVERHEAD_VARIANCE',
      refId: refId,
      idempotencyKey: `OH_VAR_${refId}_${Date.now()}`
    })

    return journalId
  }

  /**
   * Schedule variance monitoring job
   * This would typically be called by a cron job or scheduler
   */
  static async scheduleVarianceMonitoring(): Promise<void> {
    try {
      // Get all variance alerts with MEDIUM or higher severity
      const alerts = await this.getVarianceAlerts('MEDIUM')
      
      // For each alert, you could:
      // 1. Send notifications
      // 2. Create journal entries for significant variances
      // 3. Generate reports
      
      console.log(`Found ${alerts.length} variance alerts requiring attention`)
      
      // Example: Post journal entries for HIGH severity variances
      for (const alert of alerts) {
        if (alert.severity === 'HIGH' && Math.abs(alert.totalVariance) > 1000) { // Threshold example
          try {
            const journalId = await PostingService.postEventJournal({
              event: 'PROCESS_COST_VARIANCE',
              amount: Math.abs(alert.totalVariance),
              memo: `High variance alert for MO ${alert.moId} Stage ${alert.stageNo}: ${alert.totalVariance}`,
              refType: 'VARIANCE_ALERT',
              refId: `${alert.moId}-${alert.stageNo}`,
              idempotencyKey: `VAR_ALERT_${alert.moId}_${alert.stageNo}_${Date.now()}`
            })
            
            console.log(`Posted journal entry ${journalId} for variance alert`)
          } catch (error) {
            console.error(`Failed to post journal entry for variance alert:`, error)
          }
        }
      }
    } catch (error) {
      console.error('Error in variance monitoring:', error)
      throw error
    }
  }
}

// Export the class as a named export for better module compatibility

// Export default instance for convenience
export default VarianceMonitoringService