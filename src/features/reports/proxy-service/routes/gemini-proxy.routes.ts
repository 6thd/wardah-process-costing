/**
 * Gemini Proxy Routes - Real Data Integration
 * مسارات البروكسي لربط لوحة Gemini بالبيانات الحقيقية
 */

import { Router, Request, Response } from 'express';
import { geminiFinancialService } from '@/services/gemini-financial-service';
import { supabase, getEffectiveTenantId } from '@/lib/supabase';

const router = Router();

// Middleware للتحقق من هوية المستخدم — يتحقق من جلسة Supabase حقيقية للمستخدم
// المرسل، لا من سر ثابت مشترك يمنح أي حامل له وصولاً دائمًا عند تسربه.
const verifyApiKey = async (req: Request, res: Response, next: any) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.slice('Bearer '.length);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    return res.status(401).json({ error: 'Unauthorized' });
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

    // Get recent GL entries (canonical table)
    const { data: entries, error } = await supabase
      .from('gl_entries')
      .select('id, entry_number, entry_date, description, description_ar, total_debit, total_credit, status')
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

    // Get inventory items with stock (products is the canonical table)
    const { data: items, error } = await supabase
      .from('products')
      .select('id, code, name, name_ar, cost_price, selling_price')
      .eq('is_active', true)
      .order('name', { ascending: true })
      .limit(50);

    if (error) throw error;

    const inventoryValue = (items || []).reduce(
      (sum, item) => sum + Number(item.cost_price || 0),
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

// A POST /generate route (Gemini content-generation proxy) used to live
// here. Removed: this Express service has no confirmed production
// deployment (no Vercel/Netlify rewrite, no Vercel Function, no working
// standalone deploy target found), so the route was dead code pointing at
// an endpoint nothing could reach. Gemini generation is being redesigned as
// a Supabase Edge Function with real auth/authorization/quota — tracked as
// separate follow-up work, not rebuilt here on a service with no deployment.

export default router;

