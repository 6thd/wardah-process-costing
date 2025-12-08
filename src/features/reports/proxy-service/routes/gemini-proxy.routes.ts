/**
 * Gemini Proxy Routes - Real Data Integration
 * مسارات البروكسي لربط لوحة Gemini بالبيانات الحقيقية
 */

import { Router, Request, Response } from 'express';
import { geminiFinancialService } from '@/services/gemini-financial-service';
import { supabase } from '@/lib/supabase';
import { getEffectiveTenantId } from '@/lib/supabase';

const router = Router();

// Middleware للتحقق من API Key
const verifyApiKey = (req: Request, res: Response, next: any) => {
  const apiKey = req.headers['x-api-key'] as string;
  const expectedKey = process.env.PROXY_AUTH_KEY || 'S3cur3Pr0xyK3y!2025#WardahERP';
  
  if (!apiKey || apiKey !== expectedKey) {
    return res.status(401).json({ error: 'Unauthorized: Invalid API key' });
  }
  
  next();
};

/**
 * GET /api/wardah/financial-data
 * جلب البيانات المالية الحقيقية
 */
router.get('/financial-data', verifyApiKey, async (req: Request, res: Response) => {
  try {
    const startDate = req.query.startDate 
      ? new Date(req.query.startDate as string) 
      : new Date(new Date().getFullYear(), 0, 1);
    const endDate = req.query.endDate 
      ? new Date(req.query.endDate as string) 
      : new Date();

    // Fetch real KPIs
    const kpis = await geminiFinancialService.fetchRealFinancialKPIs(startDate, endDate);
    
    // Fetch monthly data
    const monthlyData = await geminiFinancialService.fetchMonthlyFinancialData(endDate.getFullYear());
    
    // Format for Gemini dashboard
    const formattedData = geminiFinancialService.formatForGeminiDashboard(kpis, monthlyData);

    res.json({
      success: true,
      data: formattedData,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('Error fetching financial data:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch financial data'
    });
  }
});

/**
 * GET /api/wardah/break-even
 * حساب نقطة التعادل
 */
router.get('/break-even', verifyApiKey, async (req: Request, res: Response) => {
  try {
    const breakEven = await geminiFinancialService.calculateBreakEvenAnalysis();
    
    res.json({
      success: true,
      data: breakEven,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('Error calculating break-even:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to calculate break-even'
    });
  }
});

/**
 * GET /api/wardah/profit-loss
 * تحليل الربح والخسارة
 */
router.get('/profit-loss', verifyApiKey, async (req: Request, res: Response) => {
  try {
    const startDate = req.query.startDate 
      ? new Date(req.query.startDate as string) 
      : new Date(new Date().getFullYear(), 0, 1);
    const endDate = req.query.endDate 
      ? new Date(req.query.endDate as string) 
      : new Date();

    const analysis = await geminiFinancialService.analyzeProfitLoss(startDate, endDate);
    
    res.json({
      success: true,
      data: analysis,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('Error analyzing profit/loss:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to analyze profit/loss'
    });
  }
});

/**
 * GET /api/wardah/monthly-data
 * جلب البيانات الشهرية
 */
router.get('/monthly-data', verifyApiKey, async (req: Request, res: Response) => {
  try {
    const year = req.query.year 
      ? Number.parseInt(req.query.year as string, 10) 
      : new Date().getFullYear();

    const monthlyData = await geminiFinancialService.fetchMonthlyFinancialData(year);
    
    res.json({
      success: true,
      data: monthlyData,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('Error fetching monthly data:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch monthly data'
    });
  }
});

/**
 * GET /api/wardah/kpis
 * جلب KPIs المالية
 */
router.get('/kpis', verifyApiKey, async (req: Request, res: Response) => {
  try {
    const startDate = req.query.startDate 
      ? new Date(req.query.startDate as string) 
      : new Date(new Date().getFullYear(), 0, 1);
    const endDate = req.query.endDate 
      ? new Date(req.query.endDate as string) 
      : new Date();

    const kpis = await geminiFinancialService.fetchRealFinancialKPIs(startDate, endDate);
    
    res.json({
      success: true,
      data: kpis,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('Error fetching KPIs:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch KPIs'
    });
  }
});

/**
 * GET /api/wardah/transactions
 * جلب المعاملات الأخيرة
 */
router.get('/transactions', verifyApiKey, async (req: Request, res: Response) => {
  try {
    const tenantId = await getEffectiveTenantId();
    if (!tenantId) throw new Error('Tenant ID not found');

    const limit = Number.parseInt(req.query.limit as string, 10) || 10;

    // Get recent journal entries
    const { data: entries, error } = await supabase
      .from('journal_entries')
      .select(`
        id,
        entry_number,
        entry_date,
        description,
        description_ar,
        total_debit,
        total_credit,
        status
      `)
      .eq('status', 'posted')
      .order('entry_date', { ascending: false })
      .limit(limit);

    if (error) throw error;

    res.json({
      success: true,
      data: entries || [],
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch transactions'
    });
  }
});

/**
 * GET /api/wardah/inventory
 * جلب بيانات المخزون
 */
router.get('/inventory', verifyApiKey, async (req: Request, res: Response) => {
  try {
    const tenantId = await getEffectiveTenantId();
    if (!tenantId) throw new Error('Tenant ID not found');

    // Get inventory items with stock
    const { data: items, error } = await supabase
      .from('items')
      .select('id, code, name, name_ar, stock_quantity, cost_price, selling_price')
      .eq('is_active', true)
      .gt('stock_quantity', 0)
      .order('stock_quantity', { ascending: false })
      .limit(50);

    if (error) throw error;

    const inventoryValue = (items || []).reduce(
      (sum, item) => sum + (Number(item.stock_quantity || 0) * Number(item.cost_price || 0)),
      0
    );

    res.json({
      success: true,
      data: {
        items: items || [],
        totalValue: inventoryValue,
        totalItems: items?.length || 0
      },
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('Error fetching inventory:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch inventory'
    });
  }
});

export default router;

