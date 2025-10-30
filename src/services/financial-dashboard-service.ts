import { getSupabase } from '@/lib/supabase'
import { getTenantId } from '@/lib/supabase'

// Interface for financial KPIs
export interface FinancialKPIs {
  totalSales: number
  totalCosts: number
  netProfit: number
  grossProfit: number
  inventoryValue: number
  totalAssets: number
  totalLiabilities: number
  equity: number
  profitMargin: number
  revenueGrowth: number
  operationalEfficiency: number
}

// Interface for chart data
export interface ChartData {
  revenue: number[]
  costs: number[]
  profit: number[]
  months: string[]
}

// Interface for dashboard data
export interface DashboardData {
  kpis: FinancialKPIs
  charts: ChartData
  recentTransactions: any[]
  topProducts: any[]
}

// Financial Dashboard Service
class FinancialDashboardService {
  // Fetch financial KPIs from Supabase
  async fetchFinancialKPIs(): Promise<FinancialKPIs> {
    try {
      const supabase = getSupabase()
      const tenantId = await getTenantId()
      
      if (!supabase) {
        throw new Error('Supabase client not initialized')
      }
      
      if (!tenantId) {
        throw new Error('Tenant ID not found')
      }
      
      // Fetch sales data
      const { data: salesData, error: salesError } = await supabase
        .from('sales_orders')
        .select('total_amount')
        .eq('tenant_id', tenantId)
        .gte('created_at', this.getStartOfMonth())
      
      if (salesError) throw salesError
      
      const totalSales = salesData?.reduce((sum, order) => sum + (order.total_amount || 0), 0) || 0
      
      // Fetch purchase data (costs)
      const { data: purchaseData, error: purchaseError } = await supabase
        .from('purchase_orders')
        .select('total_amount')
        .eq('tenant_id', tenantId)
        .gte('created_at', this.getStartOfMonth())
      
      if (purchaseError) throw purchaseError
      
      const totalCosts = purchaseData?.reduce((sum, order) => sum + (order.total_amount || 0), 0) || 0
      
      // Calculate profit metrics
      const grossProfit = totalSales - totalCosts
      const netProfit = grossProfit * 0.85 // Simplified net profit calculation
      const profitMargin = totalSales > 0 ? (netProfit / totalSales) * 100 : 0
      
      // Fetch inventory data
      const { data: inventoryData, error: inventoryError } = await supabase
        .from('items')
        .select('stock_quantity, cost_price')
        .eq('tenant_id', tenantId)
      
      if (inventoryError) throw inventoryError
      
      const inventoryValue = inventoryData?.reduce(
        (sum, item) => sum + (item.stock_quantity || 0) * (item.cost_price || 0), 
        0
      ) || 0
      
      // Simplified balance sheet data
      const totalAssets = inventoryValue + (totalSales * 0.2) // Simplified
      const totalLiabilities = totalCosts * 0.6 // Simplified
      const equity = totalAssets - totalLiabilities
      
      // Calculate growth metrics
      const revenueGrowth = this.calculateGrowth(totalSales, totalSales * 0.9) // Simplified
      const operationalEfficiency = Math.min(100, (grossProfit / totalSales) * 100)
      
      return {
        totalSales,
        totalCosts,
        netProfit,
        grossProfit,
        inventoryValue,
        totalAssets,
        totalLiabilities,
        equity,
        profitMargin,
        revenueGrowth,
        operationalEfficiency
      }
    } catch (error) {
      console.error('Error fetching financial KPIs:', error)
      // Return default values if there's an error
      return this.getDefaultKPIs()
    }
  }
  
  // Fetch chart data for the last 6 months
  async fetchChartData(): Promise<ChartData> {
    try {
      const supabase = getSupabase()
      const tenantId = await getTenantId()
      
      if (!supabase) {
        throw new Error('Supabase client not initialized')
      }
      
      if (!tenantId) {
        throw new Error('Tenant ID not found')
      }
      
      const months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو']
      const revenue: number[] = []
      const costs: number[] = []
      const profit: number[] = []
      
      // For each month, fetch data (simplified implementation)
      for (let i = 0; i < months.length; i++) {
        // In a real implementation, you would fetch data for each specific month
        // This is a simplified version for demonstration
        const baseValue = 100000 + (i * 15000)
        revenue.push(baseValue)
        costs.push(baseValue * 0.7)
        profit.push(baseValue * 0.3)
      }
      
      return {
        revenue,
        costs,
        profit,
        months
      }
    } catch (error) {
      console.error('Error fetching chart data:', error)
      // Return default chart data if there's an error
      return this.getDefaultChartData()
    }
  }
  
  // Fetch recent transactions
  async fetchRecentTransactions(): Promise<any[]> {
    try {
      const supabase = getSupabase()
      const tenantId = await getTenantId()
      
      if (!supabase) {
        throw new Error('Supabase client not initialized')
      }
      
      if (!tenantId) {
        throw new Error('Tenant ID not found')
      }
      
      // Fetch recent sales orders
      const { data: salesData, error: salesError } = await supabase
        .from('sales_orders')
        .select(`
          id,
          order_number,
          total_amount,
          created_at,
          customer:customers(name)
        `)
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(5)
      
      if (salesError) throw salesError
      
      return salesData || []
    } catch (error) {
      console.error('Error fetching recent transactions:', error)
      return []
    }
  }
  
  // Fetch top selling products
  async fetchTopProducts(): Promise<any[]> {
    try {
      const supabase = getSupabase()
      const tenantId = await getTenantId()
      
      if (!supabase) {
        throw new Error('Supabase client not initialized')
      }
      
      if (!tenantId) {
        throw new Error('Tenant ID not found')
      }
      
      // Fetch items with highest sales (simplified)
      const { data: itemsData, error: itemsError } = await supabase
        .from('items')
        .select(`
          id,
          name,
          code,
          stock_quantity,
          cost_price,
          sales_count
        `)
        .eq('tenant_id', tenantId)
        .order('sales_count', { ascending: false })
        .limit(5)
      
      if (itemsError) throw itemsError
      
      return itemsData || []
    } catch (error) {
      console.error('Error fetching top products:', error)
      return []
    }
  }
  
  // Fetch complete dashboard data
  async fetchDashboardData(): Promise<DashboardData> {
    try {
      const [kpis, charts, recentTransactions, topProducts] = await Promise.all([
        this.fetchFinancialKPIs(),
        this.fetchChartData(),
        this.fetchRecentTransactions(),
        this.fetchTopProducts()
      ])
      
      return {
        kpis,
        charts,
        recentTransactions,
        topProducts
      }
    } catch (error) {
      console.error('Error fetching dashboard data:', error)
      throw error
    }
  }
  
  // Helper methods
  private getStartOfMonth(): string {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  }
  
  private calculateGrowth(current: number, previous: number): number {
    if (previous === 0) return 0
    return ((current - previous) / previous) * 100
  }
  
  private getDefaultKPIs(): FinancialKPIs {
    return {
      totalSales: 0,
      totalCosts: 0,
      netProfit: 0,
      grossProfit: 0,
      inventoryValue: 0,
      totalAssets: 0,
      totalLiabilities: 0,
      equity: 0,
      profitMargin: 0,
      revenueGrowth: 0,
      operationalEfficiency: 0
    }
  }
  
  private getDefaultChartData(): ChartData {
    return {
      revenue: [0, 0, 0, 0, 0, 0],
      costs: [0, 0, 0, 0, 0, 0],
      profit: [0, 0, 0, 0, 0, 0],
      months: ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو']
    }
  }
}

// Export singleton instance
export const financialDashboardService = new FinancialDashboardService()