import { Router, Request, Response } from 'express';

const router = Router();

// Mock data that matches the expected structure
const mockKpis = {
  totalSales: 1500000,
  totalCosts: 900000,
  netProfit: 450000,
  grossProfit: 600000,
  inventoryValue: 750000,
  totalAssets: 2000000,
  totalLiabilities: 800000,
  equity: 1200000,
  profitMargin: 30,
  revenueGrowth: 12.5,
  operationalEfficiency: 85.2
};

const mockCharts = {
  revenue: [120000, 135000, 150000, 140000, 160000, 175000, 180000, 190000, 185000, 200000, 210000, 220000],
  costs: [80000, 90000, 100000, 95000, 110000, 120000, 125000, 130000, 128000, 135000, 140000, 145000],
  profit: [40000, 45000, 50000, 45000, 50000, 55000, 55000, 60000, 57000, 65000, 70000, 75000],
  months: ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']
};

const mockTransactions = [
  {
    id: '1',
    order_number: 'SO-2025-001',
    total_amount: 15000,
    created_at: '2025-10-01T10:30:00Z',
    customer: {
      name: 'العميل الأول'
    }
  },
  {
    id: '2',
    order_number: 'SO-2025-002',
    total_amount: 22000,
    created_at: '2025-10-02T14:15:00Z',
    customer: {
      name: 'العميل الثاني'
    }
  }
];

const mockProducts = [
  {
    id: '1',
    name: 'كريم ورد عطري',
    code: 'PRD-001',
    stock_quantity: 100,
    cost_price: 25.5,
    sales_count: 50
  },
  {
    id: '2',
    name: 'صابون زعتر طبيعي',
    code: 'PRD-002',
    stock_quantity: 75,
    cost_price: 18,
    sales_count: 45
  }
];

// جلب بيانات KPIs
router.get('/kpis', async (req: Request, res: Response) => {
  try {
    res.json(mockKpis);
  } catch (error) {
    console.error('Error fetching KPIs:', error);
    res.status(500).json({ error: 'خطأ في جلب بيانات KPIs' });
  }
});

// جلب بيانات الرسوم البيانية
router.get('/charts', async (req: Request, res: Response) => {
  try {
    res.json(mockCharts);
  } catch (error) {
    console.error('Error fetching chart data:', error);
    res.status(500).json({ error: 'خطأ في جلب بيانات الرسوم البيانية' });
  }
});

// جلب المعاملات الأخيرة
router.get('/financial/recent-transactions', async (req: Request, res: Response) => {
  try {
    res.json(mockTransactions);
  } catch (error) {
    console.error('Error fetching recent transactions:', error);
    res.status(500).json({ error: 'خطأ في جلب المعاملات الأخيرة' });
  }
});

// جلب المنتجات الأكثر مبيعًا
router.get('/financial/top-products', async (req: Request, res: Response) => {
  try {
    res.json(mockProducts);
  } catch (error) {
    console.error('Error fetching top products:', error);
    res.status(500).json({ error: 'خطأ في جلب المنتجات الأكثر مبيعًا' });
  }
});

// جلب بيانات لوحة التحكم المالية الكاملة
router.get('/financial/dashboard', async (req: Request, res: Response) => {
  try {
    const mockData = {
      kpis: mockKpis,
      charts: mockCharts,
      recentTransactions: mockTransactions,
      topProducts: mockProducts
    };
    res.json(mockData);
  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    res.status(500).json({ error: 'خطأ في جلب بيانات لوحة التحكم' });
  }
});

export { router as dataRoutes };