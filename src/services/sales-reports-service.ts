/**
 * Sales Reports Service
 * خدمة تقارير المبيعات
 * 
 * Provides comprehensive sales reporting and profitability analysis
 */

import { supabase } from '@/lib/supabase';
import { getEffectiveTenantId } from '@/lib/supabase';
import { calculateInvoiceProfit } from './enhanced-sales-service';

// ===== TYPES =====

export interface SalesPerformanceMetrics {
  totalSales: number;
  totalInvoices: number;
  totalOrders: number;
  averageOrderValue: number;
  totalCollections: number;
  outstandingAmount: number;
  collectionRate: number; // percentage
  periodStart: string;
  periodEnd: string;
}

export interface CustomerSalesAnalysis {
  customerId: string;
  customerCode: string;
  customerName: string;
  customerNameAr?: string;
  totalSales: number;
  totalInvoices: number;
  averageInvoiceValue: number;
  totalCollections: number;
  outstandingAmount: number;
  collectionRate: number;
  lastOrderDate?: string;
  lastInvoiceDate?: string;
}

export interface ProductSalesAnalysis {
  productId: string;
  productCode: string;
  productName: string;
  productNameAr?: string;
  totalQuantitySold: number;
  totalRevenue: number;
  totalCOGS: number;
  totalProfit: number;
  profitMargin: number; // percentage
  averageUnitPrice: number;
  averageUnitCost: number;
  numberOfInvoices: number;
}

export interface MonthlySalesTrend {
  month: string;
  monthName: string;
  monthNameAr: string;
  totalSales: number;
  totalInvoices: number;
  totalCollections: number;
  averageOrderValue: number;
}

export interface ProfitabilityAnalysis {
  totalRevenue: number;
  totalCOGS: number;
  grossProfit: number;
  grossProfitMargin: number; // percentage
  totalExpenses: number; // Operating expenses (if available)
  netProfit: number;
  netProfitMargin: number; // percentage
  byCustomer: CustomerSalesAnalysis[];
  byProduct: ProductSalesAnalysis[];
  monthlyTrends: MonthlySalesTrend[];
}

// ===== SALES PERFORMANCE REPORT =====

/**
 * Get sales performance metrics for a period
 */
export async function getSalesPerformance(
  startDate: string,
  endDate: string
): Promise<SalesPerformanceMetrics> {
  try {
    const tenantId = await getEffectiveTenantId();
    if (!tenantId) throw new Error('Tenant ID not found');

    // Get sales invoices
    // sales_invoices table uses org_id, not tenant_id
    let invoicesQuery = supabase
      .from('sales_invoices')
      .select('id, total_amount, paid_amount, invoice_date')
      .gte('invoice_date', startDate)
      .lte('invoice_date', endDate);

    // Try to filter by org_id first (correct column name)
    if (tenantId) {
      invoicesQuery = invoicesQuery.eq('org_id', tenantId);
    }

    let { data: invoices, error: invoicesError } = await invoicesQuery;

    // If org_id doesn't exist, try tenant_id (fallback)
    if (invoicesError && (invoicesError.code === '42703' || (invoicesError.message && invoicesError.message.includes('org_id')))) {
      console.warn('org_id column not found in sales_invoices, trying tenant_id');
      invoicesQuery = supabase
        .from('sales_invoices')
        .select('id, total_amount, paid_amount, invoice_date')
        .eq('tenant_id', tenantId)
        .gte('invoice_date', startDate)
        .lte('invoice_date', endDate);
      
      const retryResult = await invoicesQuery;
      invoices = retryResult.data;
      invoicesError = retryResult.error;
      
      // If tenant_id also fails, skip tenant filter
      if (invoicesError && (invoicesError.code === '42703' || (invoicesError.message && invoicesError.message.includes('tenant_id')))) {
        console.warn('Neither org_id nor tenant_id found in sales_invoices, skipping tenant filter');
        invoicesQuery = supabase
          .from('sales_invoices')
          .select('id, total_amount, paid_amount, invoice_date')
          .gte('invoice_date', startDate)
          .lte('invoice_date', endDate);
        
        const finalResult = await invoicesQuery;
        invoices = finalResult.data;
        invoicesError = finalResult.error;
      }
    }

    if (invoicesError) throw invoicesError;

    // Get sales orders (if table exists)
    // sales_orders table may use org_id or tenant_id
    let ordersQuery = supabase
      .from('sales_orders')
      .select('id, total_amount, so_date')
      .gte('so_date', startDate)
      .lte('so_date', endDate);

    // Try to filter by org_id first (most common)
    if (tenantId) {
      ordersQuery = ordersQuery.eq('org_id', tenantId);
    }

    let { data: orders, error: ordersError } = await ordersQuery;
    
    // If org_id doesn't exist, try tenant_id
    if (ordersError && tenantId && (ordersError.code === '42703' || (ordersError.message && ordersError.message.includes('org_id')))) {
      console.warn('org_id column not found in sales_orders, trying tenant_id');
      ordersQuery = supabase
        .from('sales_orders')
        .select('id, total_amount, so_date')
        .eq('tenant_id', tenantId)
        .gte('so_date', startDate)
        .lte('so_date', endDate);
      
      const retryResult = await ordersQuery;
      orders = retryResult.data;
      ordersError = retryResult.error;
    }
    
    // If sales_orders table doesn't exist, just return empty array
    if (ordersError && ordersError.code === 'PGRST205') {
      console.warn('sales_orders table not found, skipping orders data');
      orders = []; // Set to empty array
      ordersError = null; // Clear error
    } else if (ordersError) {
      console.warn('Error fetching sales orders:', ordersError);
      orders = []; // Set to empty array
      ordersError = null; // Clear error
    }

    // Get collections (if table exists)
    let collectionsQuery = supabase
      .from('customer_collections')
      .select('amount, collection_date')
      .gte('collection_date', startDate)
      .lte('collection_date', endDate);

    // Try to filter by org_id first
    if (tenantId) {
      collectionsQuery = collectionsQuery.eq('org_id', tenantId);
    }

    let { data: collections, error: collectionsError } = await collectionsQuery;
    
    // If org_id doesn't exist, try tenant_id
    if (collectionsError && tenantId && (collectionsError.code === '42703' || (collectionsError.message && collectionsError.message.includes('org_id')))) {
      console.warn('org_id column not found in customer_collections, trying tenant_id');
      collectionsQuery = supabase
        .from('customer_collections')
        .select('amount, collection_date')
        .eq('tenant_id', tenantId)
        .gte('collection_date', startDate)
        .lte('collection_date', endDate);
      
      const retryResult = await collectionsQuery;
      collections = retryResult.data;
      collectionsError = retryResult.error;
    }
    
    // If customer_collections table doesn't exist, just return empty array
    if (collectionsError && collectionsError.code === 'PGRST205') {
      console.warn('customer_collections table not found, skipping collections data');
      collections = []; // Set to empty array
      collectionsError = null; // Clear error
    } else if (collectionsError) {
      console.warn('Error fetching collections:', collectionsError);
      collections = []; // Set to empty array
      collectionsError = null; // Clear error
    }

    const totalSales = (invoices || []).reduce((sum, inv) => sum + Number(inv.total_amount || 0), 0);
    const totalCollections = (collections || []).reduce((sum, col) => sum + Number(col.amount || 0), 0);
    const outstandingAmount = (invoices || []).reduce((sum, inv) => {
      const paid = Number(inv.paid_amount || 0);
      const total = Number(inv.total_amount || 0);
      return sum + (total - paid);
    }, 0);

    const totalInvoices = invoices?.length || 0;
    const totalOrders = orders?.length || 0;
    const averageOrderValue = totalOrders > 0 ? totalSales / totalOrders : 0;
    const collectionRate = totalSales > 0 ? (totalCollections / totalSales) * 100 : 0;

    return {
      totalSales,
      totalInvoices,
      totalOrders,
      averageOrderValue,
      totalCollections,
      outstandingAmount,
      collectionRate,
      periodStart: startDate,
      periodEnd: endDate
    };
  } catch (error: any) {
    console.error('Error getting sales performance:', error);
    throw error;
  }
}

// ===== CUSTOMER ANALYSIS =====

/**
 * Get customer sales analysis
 */
export async function getCustomerSalesAnalysis(
  startDate?: string,
  endDate?: string,
  customerId?: string
): Promise<CustomerSalesAnalysis[]> {
  try {
    const tenantId = await getEffectiveTenantId();
    if (!tenantId) throw new Error('Tenant ID not found');

    // sales_invoices uses org_id
    let invoicesQuery = supabase
      .from('sales_invoices')
      .select(`
        id,
        customer_id,
        total_amount,
        paid_amount,
        invoice_date,
        customers!inner (
          id,
          code,
          name
        )
      `);

    // Try to filter by org_id first (correct column name)
    if (tenantId) {
      invoicesQuery = invoicesQuery.eq('org_id', tenantId);
    }

    if (startDate) {
      invoicesQuery = invoicesQuery.gte('invoice_date', startDate);
    }
    if (endDate) {
      invoicesQuery = invoicesQuery.lte('invoice_date', endDate);
    }
    if (customerId) {
      invoicesQuery = invoicesQuery.eq('customer_id', customerId);
    }

    let { data: invoices, error: invoicesError } = await invoicesQuery;

    // If org_id doesn't exist, try tenant_id
    if (invoicesError && tenantId && (invoicesError.code === '42703' || (invoicesError.message && invoicesError.message.includes('org_id')))) {
      console.warn('org_id column not found in sales_invoices, trying tenant_id');
      invoicesQuery = supabase
        .from('sales_invoices')
        .select(`
          id,
          customer_id,
          total_amount,
          paid_amount,
          invoice_date,
          customers!inner (
            id,
            code,
            name,
            name_ar
          )
        `)
        .eq('tenant_id', tenantId);
      
      if (startDate) {
        invoicesQuery = invoicesQuery.gte('invoice_date', startDate);
      }
      if (endDate) {
        invoicesQuery = invoicesQuery.lte('invoice_date', endDate);
      }
      if (customerId) {
        invoicesQuery = invoicesQuery.eq('customer_id', customerId);
      }
      
      const retryResult = await invoicesQuery;
      invoices = retryResult.data;
      invoicesError = retryResult.error;
      
      // If tenant_id also fails, skip tenant filter
      if (invoicesError && (invoicesError.code === '42703' || (invoicesError.message && invoicesError.message.includes('tenant_id')))) {
        console.warn('Neither org_id nor tenant_id found in sales_invoices, skipping tenant filter');
        invoicesQuery = supabase
          .from('sales_invoices')
          .select(`
            id,
            customer_id,
            total_amount,
            paid_amount,
            invoice_date,
            customers!inner (
              id,
              code,
              name,
              name_ar
            )
          `);
        
        if (startDate) {
          invoicesQuery = invoicesQuery.gte('invoice_date', startDate);
        }
        if (endDate) {
          invoicesQuery = invoicesQuery.lte('invoice_date', endDate);
        }
        if (customerId) {
          invoicesQuery = invoicesQuery.eq('customer_id', customerId);
        }
        
        const finalResult = await invoicesQuery;
        invoices = finalResult.data;
        invoicesError = finalResult.error;
      }
    }

    if (invoicesError) throw invoicesError;

    // Group by customer
    const customerMap = new Map<string, CustomerSalesAnalysis>();

    (invoices || []).forEach((inv: any) => {
      const customer = inv.customers;
      if (!customer) return;

      const customerId = customer.id;
      const totalAmount = Number(inv.total_amount || 0);
      const paidAmount = Number(inv.paid_amount || 0);

      if (!customerMap.has(customerId)) {
        customerMap.set(customerId, {
          customerId: customer.id,
          customerCode: customer.code,
          customerName: customer.name,
          customerNameAr: customer.name_ar,
          totalSales: 0,
          totalInvoices: 0,
          averageInvoiceValue: 0,
          totalCollections: 0,
          outstandingAmount: 0,
          collectionRate: 0,
          lastInvoiceDate: inv.invoice_date
        });
      }

      const analysis = customerMap.get(customerId)!;
      analysis.totalSales += totalAmount;
      analysis.totalInvoices += 1;
      analysis.totalCollections += paidAmount;
      analysis.outstandingAmount += (totalAmount - paidAmount);
      
      if (inv.invoice_date > (analysis.lastInvoiceDate || '')) {
        analysis.lastInvoiceDate = inv.invoice_date;
      }
    });

    // Calculate averages and rates
    const results = Array.from(customerMap.values()).map(analysis => {
      analysis.averageInvoiceValue = analysis.totalInvoices > 0 
        ? analysis.totalSales / analysis.totalInvoices 
        : 0;
      analysis.collectionRate = analysis.totalSales > 0 
        ? (analysis.totalCollections / analysis.totalSales) * 100 
        : 0;
      return analysis;
    });

    // Sort by total sales descending
    return results.sort((a, b) => b.totalSales - a.totalSales);
  } catch (error: any) {
    console.error('Error getting customer sales analysis:', error);
    throw error;
  }
}

// ===== PRODUCT SALES ANALYSIS =====

/**
 * Get product sales analysis with profitability
 */
export async function getProductSalesAnalysis(
  startDate?: string,
  endDate?: string,
  productId?: string
): Promise<ProductSalesAnalysis[]> {
  try {
    const tenantId = await getEffectiveTenantId();
    if (!tenantId) throw new Error('Tenant ID not found');

    // Get invoice lines with products
    // First, get invoices in date range
    // sales_invoices uses org_id
    let invoicesQuery = supabase
      .from('sales_invoices')
      .select('id, invoice_date')
      .eq('org_id', tenantId);

    if (startDate) {
      invoicesQuery = invoicesQuery.gte('invoice_date', startDate);
    }
    if (endDate) {
      invoicesQuery = invoicesQuery.lte('invoice_date', endDate);
    }

    let { data: invoices, error: invoicesError } = await invoicesQuery;
    
    // If org_id doesn't exist, try tenant_id
    if (invoicesError && tenantId && (invoicesError.code === '42703' || (invoicesError.message && invoicesError.message.includes('org_id')))) {
      console.warn('org_id column not found in sales_invoices, trying tenant_id');
      invoicesQuery = supabase
        .from('sales_invoices')
        .select('id, invoice_date')
        .eq('tenant_id', tenantId);
      
      if (startDate) {
        invoicesQuery = invoicesQuery.gte('invoice_date', startDate);
      }
      if (endDate) {
        invoicesQuery = invoicesQuery.lte('invoice_date', endDate);
      }
      
      const retryResult = await invoicesQuery;
      invoices = retryResult.data;
      invoicesError = retryResult.error;
    }
    
    // If tenant_id also fails, skip tenant filter
    if (invoicesError && tenantId && (invoicesError.code === '42703' || (invoicesError.message && invoicesError.message.includes('tenant_id')))) {
      console.warn('Neither org_id nor tenant_id found in sales_invoices, skipping tenant filter');
      invoicesQuery = supabase
        .from('sales_invoices')
        .select('id, invoice_date');
      
      if (startDate) {
        invoicesQuery = invoicesQuery.gte('invoice_date', startDate);
      }
      if (endDate) {
        invoicesQuery = invoicesQuery.lte('invoice_date', endDate);
      }
      
      const finalResult = await invoicesQuery;
      invoices = finalResult.data;
      invoicesError = finalResult.error;
    }
    
    // If invoices query fails, return empty array
    if (invoicesError) {
      console.warn('Error fetching invoices for product analysis:', invoicesError);
      return [];
    }

    const invoiceIds = (invoices || []).map(inv => inv.id);

    if (invoiceIds.length === 0) {
      return [];
    }

    // Get invoice lines
    // sales_invoice_lines may use org_id
    let invoiceLinesQuery = supabase
      .from('sales_invoice_lines')
      .select(`
        id,
        sales_invoice_id,
        product_id,
        quantity,
        unit_price,
        line_total,
        unit_cost_at_sale,
        items!inner (
          id,
          code,
          name
        )
      `)
      .in('sales_invoice_id', invoiceIds);

    // Try to filter by org_id first (if column exists)
    // Note: invoice_lines may not have tenant/org column, so we'll skip if it fails
    if (tenantId) {
      invoiceLinesQuery = invoiceLinesQuery.eq('org_id', tenantId);
    }

    if (productId) {
      invoiceLinesQuery = invoiceLinesQuery.eq('product_id', productId);
    }

    let { data: invoiceLines, error: linesError } = await invoiceLinesQuery;

    // If relationship with items doesn't exist, try without items join
    if (linesError && (linesError.code === 'PGRST200' || (linesError.message && linesError.message.includes('relationship')))) {
      console.warn('items relationship not found in sales_invoice_lines, trying without join');
      let retryQuery = supabase
        .from('sales_invoice_lines')
        .select(`
          id,
          sales_invoice_id,
          product_id,
          quantity,
          unit_price,
          line_total,
          unit_cost_at_sale
        `)
        .in('sales_invoice_id', invoiceIds);
      
      if (tenantId) {
        retryQuery = retryQuery.eq('org_id', tenantId);
      }
      
      if (productId) {
        retryQuery = retryQuery.eq('product_id', productId);
      }
      
      const retryResult = await retryQuery;
      invoiceLines = retryResult.data;
      linesError = retryResult.error;
      
      // If we got lines without items, fetch items separately
      if (invoiceLines && invoiceLines.length > 0) {
        const productIds = [...new Set(invoiceLines.map((line: any) => line.product_id).filter(Boolean))];
        if (productIds.length > 0) {
          const { data: itemsData } = await supabase
            .from('items')
            .select('id, code, name')
            .in('id', productIds);
          
          // Map items to lines
          const itemsMap = new Map((itemsData || []).map((item: any) => [item.id, item]));
          invoiceLines = invoiceLines.map((line: any) => ({
            ...line,
            items: itemsMap.get(line.product_id) || { id: line.product_id, code: '', name: '' }
          }));
        }
      }
    }
    
    // If org_id doesn't exist in invoice_lines, try without tenant filter
    // (invoice_lines may not have tenant/org column)
    if (linesError && tenantId && (linesError.code === '42703' || (linesError.message && linesError.message.includes('org_id')))) {
      console.warn('org_id column not found in sales_invoice_lines, trying without tenant filter');
      let finalRetryQuery = supabase
        .from('sales_invoice_lines')
        .select(`
          id,
          sales_invoice_id,
          product_id,
          quantity,
          unit_price,
          line_total,
          unit_cost_at_sale
        `)
        .in('sales_invoice_id', invoiceIds);
      
      if (productId) {
        finalRetryQuery = finalRetryQuery.eq('product_id', productId);
      }
      
      const retryResult = await finalRetryQuery;
      invoiceLines = retryResult.data;
      linesError = retryResult.error;
      
      // If we got lines without items, fetch items separately
      if (invoiceLines && invoiceLines.length > 0) {
        const productIds = [...new Set(invoiceLines.map((line: any) => line.product_id).filter(Boolean))];
        if (productIds.length > 0) {
          const { data: itemsData } = await supabase
            .from('items')
            .select('id, code, name')
            .in('id', productIds);
          
          // Map items to lines
          const itemsMap = new Map((itemsData || []).map((item: any) => [item.id, item]));
          invoiceLines = invoiceLines.map((line: any) => ({
            ...line,
            items: [itemsMap.get(line.product_id) || { id: line.product_id, code: '', name: '' }]
          }));
        }
      }
    }

    if (linesError) throw linesError;

    // Group by product
    const productMap = new Map<string, ProductSalesAnalysis>();

    (invoiceLines || []).forEach((line: any) => {
      const product = line.items;
      if (!product) return;

      const productId = product.id;
      const quantity = Number(line.quantity || 0);
      const revenue = Number(line.line_total || 0);
      // Calculate COGS from unit_cost_at_sale * quantity
      const unitCost = Number(line.unit_cost_at_sale || 0);
      const cogs = unitCost * quantity;
      const unitPrice = Number(line.unit_price || 0);

      if (!productMap.has(productId)) {
        productMap.set(productId, {
          productId: product.id,
          productCode: product.code,
          productName: product.name,
          productNameAr: product.name_ar,
          totalQuantitySold: 0,
          totalRevenue: 0,
          totalCOGS: 0,
          totalProfit: 0,
          profitMargin: 0,
          averageUnitPrice: 0,
          averageUnitCost: 0,
          numberOfInvoices: 0
        });
      }

      const analysis = productMap.get(productId)!;
      analysis.totalQuantitySold += quantity;
      analysis.totalRevenue += revenue;
      analysis.totalCOGS += cogs;
      analysis.totalProfit += (revenue - cogs);
      analysis.numberOfInvoices += 1;
    });

    // Calculate averages and margins
    const results = Array.from(productMap.values()).map(analysis => {
      analysis.averageUnitPrice = analysis.totalQuantitySold > 0 
        ? analysis.totalRevenue / analysis.totalQuantitySold 
        : 0;
      analysis.averageUnitCost = analysis.totalQuantitySold > 0 
        ? analysis.totalCOGS / analysis.totalQuantitySold 
        : 0;
      analysis.profitMargin = analysis.totalRevenue > 0 
        ? (analysis.totalProfit / analysis.totalRevenue) * 100 
        : 0;
      return analysis;
    });

    // Sort by total revenue descending
    return results.sort((a, b) => b.totalRevenue - a.totalRevenue);
  } catch (error: any) {
    console.error('Error getting product sales analysis:', error);
    throw error;
  }
}

// ===== MONTHLY TRENDS =====

/**
 * Get monthly sales trends
 */
export async function getMonthlySalesTrends(
  startDate: string,
  endDate: string
): Promise<MonthlySalesTrend[]> {
  try {
    const tenantId = await getEffectiveTenantId();
    if (!tenantId) throw new Error('Tenant ID not found');

    // sales_invoices uses org_id
    let invoicesQuery = supabase
      .from('sales_invoices')
      .select('id, total_amount, invoice_date')
      .gte('invoice_date', startDate)
      .lte('invoice_date', endDate)
      .order('invoice_date', { ascending: true });

    // Try to filter by org_id first
    if (tenantId) {
      invoicesQuery = invoicesQuery.eq('org_id', tenantId);
    }

    let { data: invoices, error: invoicesError } = await invoicesQuery;
    
    // If org_id doesn't exist, try tenant_id
    if (invoicesError && tenantId && (invoicesError.code === '42703' || (invoicesError.message && invoicesError.message.includes('org_id')))) {
      console.warn('org_id column not found in sales_invoices, trying tenant_id');
      invoicesQuery = supabase
        .from('sales_invoices')
        .select('id, total_amount, invoice_date')
        .eq('tenant_id', tenantId)
        .gte('invoice_date', startDate)
        .lte('invoice_date', endDate)
        .order('invoice_date', { ascending: true });
      
      const retryResult = await invoicesQuery;
      invoices = retryResult.data;
      invoicesError = retryResult.error;
    }
    
    if (invoicesError) {
      console.warn('Error fetching invoices for monthly trends:', invoicesError);
      invoices = []; // Continue with empty invoices
    }

    let collectionsQuery = supabase
      .from('customer_collections')
      .select('amount, collection_date')
      .gte('collection_date', startDate)
      .lte('collection_date', endDate)
      .order('collection_date', { ascending: true });

    // Try to filter by org_id first
    if (tenantId) {
      collectionsQuery = collectionsQuery.eq('org_id', tenantId);
    }

    let { data: collections, error: collectionsError } = await collectionsQuery;
    
    // If org_id doesn't exist, try tenant_id
    if (collectionsError && tenantId && (collectionsError.code === '42703' || (collectionsError.message && collectionsError.message.includes('org_id')))) {
      console.warn('org_id column not found in customer_collections, trying tenant_id');
      collectionsQuery = supabase
        .from('customer_collections')
        .select('amount, collection_date')
        .eq('tenant_id', tenantId)
        .gte('collection_date', startDate)
        .lte('collection_date', endDate)
        .order('collection_date', { ascending: true });
      
      const retryResult = await collectionsQuery;
      collections = retryResult.data;
      collectionsError = retryResult.error;
    }
    
    if (collectionsError && collectionsError.code !== 'PGRST205') {
      console.warn('Error fetching collections for monthly trends:', collectionsError);
      collections = []; // Continue with empty collections
    }

    // Group by month
    const monthMap = new Map<string, MonthlySalesTrend>();

    const monthNames = [
      { en: 'January', ar: 'يناير' }, { en: 'February', ar: 'فبراير' },
      { en: 'March', ar: 'مارس' }, { en: 'April', ar: 'أبريل' },
      { en: 'May', ar: 'مايو' }, { en: 'June', ar: 'يونيو' },
      { en: 'July', ar: 'يوليو' }, { en: 'August', ar: 'أغسطس' },
      { en: 'September', ar: 'سبتمبر' }, { en: 'October', ar: 'أكتوبر' },
      { en: 'November', ar: 'نوفمبر' }, { en: 'December', ar: 'ديسمبر' }
    ];

    (invoices || []).forEach((inv: any) => {
      const date = new Date(inv.invoice_date);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const monthName = monthNames[date.getMonth()];

      if (!monthMap.has(monthKey)) {
        monthMap.set(monthKey, {
          month: monthKey,
          monthName: monthName.en,
          monthNameAr: monthName.ar,
          totalSales: 0,
          totalInvoices: 0,
          totalCollections: 0,
          averageOrderValue: 0
        });
      }

      const trend = monthMap.get(monthKey)!;
      trend.totalSales += Number(inv.total_amount || 0);
      trend.totalInvoices += 1;
    });

    (collections || []).forEach((col: any) => {
      const date = new Date(col.collection_date);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

      const trend = monthMap.get(monthKey);
      if (trend) {
        trend.totalCollections += Number(col.amount || 0);
      }
    });

    // Calculate averages
    const results = Array.from(monthMap.values()).map(trend => {
      trend.averageOrderValue = trend.totalInvoices > 0 
        ? trend.totalSales / trend.totalInvoices 
        : 0;
      return trend;
    });

    // Sort by month
    return results.sort((a, b) => a.month.localeCompare(b.month));
  } catch (error: any) {
    console.error('Error getting monthly sales trends:', error);
    throw error;
  }
}

// ===== PROFITABILITY ANALYSIS =====

/**
 * Get comprehensive profitability analysis
 */
export async function getProfitabilityAnalysis(
  startDate: string,
  endDate: string
): Promise<ProfitabilityAnalysis> {
  try {
    const tenantId = await getEffectiveTenantId();
    if (!tenantId) throw new Error('Tenant ID not found');

    // Get all invoices in period
    // sales_invoices uses org_id
    let invoicesQuery = supabase
      .from('sales_invoices')
      .select('id, total_amount, invoice_date')
      .eq('org_id', tenantId)
      .gte('invoice_date', startDate)
      .lte('invoice_date', endDate);

    let { data: invoices, error: invoicesError } = await invoicesQuery;
    
    // If org_id doesn't exist, try tenant_id
    if (invoicesError && tenantId && (invoicesError.code === '42703' || (invoicesError.message && invoicesError.message.includes('org_id')))) {
      console.warn('org_id column not found in sales_invoices, trying tenant_id');
      invoicesQuery = supabase
        .from('sales_invoices')
        .select('id, total_amount, invoice_date')
        .eq('tenant_id', tenantId)
        .gte('invoice_date', startDate)
        .lte('invoice_date', endDate);
      
      const retryResult = await invoicesQuery;
      invoices = retryResult.data;
      invoicesError = retryResult.error;
    }
    
    // If tenant_id also fails, skip tenant filter
    if (invoicesError && tenantId && (invoicesError.code === '42703' || (invoicesError.message && invoicesError.message.includes('tenant_id')))) {
      console.warn('Neither org_id nor tenant_id found in sales_invoices, skipping tenant filter');
      invoicesQuery = supabase
        .from('sales_invoices')
        .select('id, total_amount, invoice_date')
        .gte('invoice_date', startDate)
        .lte('invoice_date', endDate);
      
      const finalResult = await invoicesQuery;
      invoices = finalResult.data;
      invoicesError = finalResult.error;
    }

    if (invoicesError) throw invoicesError;

    // Calculate total revenue
    const totalRevenue = (invoices || []).reduce((sum, inv) => sum + Number(inv.total_amount || 0), 0);

    // Calculate COGS and profit for each invoice
    let totalCOGS = 0;
    for (const invoice of invoices || []) {
      try {
        const profitResult = await calculateInvoiceProfit(invoice.id);
        if (profitResult.success) {
          totalCOGS += profitResult.cogs;
        }
      } catch (error) {
        console.error(`Error calculating profit for invoice ${invoice.id}:`, error);
      }
    }

    const grossProfit = totalRevenue - totalCOGS;
    const grossProfitMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

    // Get customer and product analyses
    const byCustomer = await getCustomerSalesAnalysis(startDate, endDate);
    const byProduct = await getProductSalesAnalysis(startDate, endDate);
    const monthlyTrends = await getMonthlySalesTrends(startDate, endDate);

    // For now, operating expenses are not tracked separately in sales module
    // They would come from GL/accounting module
    const totalExpenses = 0; // Placeholder
    const netProfit = grossProfit - totalExpenses;
    const netProfitMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

    return {
      totalRevenue,
      totalCOGS,
      grossProfit,
      grossProfitMargin,
      totalExpenses,
      netProfit,
      netProfitMargin,
      byCustomer,
      byProduct,
      monthlyTrends
    };
  } catch (error: any) {
    console.error('Error getting profitability analysis:', error);
    throw error;
  }
}

