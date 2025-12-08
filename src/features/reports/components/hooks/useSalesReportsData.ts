import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import {
  getSalesPerformance,
  getCustomerSalesAnalysis,
  getProductSalesAnalysis,
  getProfitabilityAnalysis,
  type SalesPerformanceMetrics,
  type CustomerSalesAnalysis,
  type ProductSalesAnalysis,
  type ProfitabilityAnalysis
} from '@/services/sales-reports-service';

interface UseSalesReportsDataProps {
  fromDate: Date | undefined;
  toDate: Date | undefined;
  activeTab: string;
  isRTL: boolean;
}

export function useSalesReportsData({ fromDate, toDate, activeTab, isRTL }: UseSalesReportsDataProps) {
  const [loading, setLoading] = useState(false);
  const [performance, setPerformance] = useState<SalesPerformanceMetrics | null>(null);
  const [customerAnalysis, setCustomerAnalysis] = useState<CustomerSalesAnalysis[]>([]);
  const [productAnalysis, setProductAnalysis] = useState<ProductSalesAnalysis[]>([]);
  const [profitability, setProfitability] = useState<ProfitabilityAnalysis | null>(null);

  const fetchData = async () => {
    if (!fromDate || !toDate) {
      toast.error(isRTL ? 'يرجى اختيار تاريخ البداية والنهاية' : 'Please select start and end dates');
      return;
    }

    setLoading(true);
    try {
      const startDateStr = format(fromDate, 'yyyy-MM-dd');
      const endDateStr = format(toDate, 'yyyy-MM-dd');

      if (activeTab === 'performance') {
        const perf = await getSalesPerformance(startDateStr, endDateStr);
        setPerformance(perf);
      } else if (activeTab === 'customers') {
        const customers = await getCustomerSalesAnalysis(startDateStr, endDateStr);
        setCustomerAnalysis(customers);
      } else if (activeTab === 'products') {
        const products = await getProductSalesAnalysis(startDateStr, endDateStr);
        setProductAnalysis(products);
      } else if (activeTab === 'profitability') {
        const profit = await getProfitabilityAnalysis(startDateStr, endDateStr);
        setProfitability(profit);
      }
    } catch (error: any) {
      console.error('Error fetching sales reports:', error);
      toast.error(error.message || (isRTL ? 'حدث خطأ في جلب البيانات' : 'Error fetching data'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (fromDate && toDate) {
      fetchData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  return {
    loading,
    performance,
    customerAnalysis,
    productAnalysis,
    profitability,
    fetchData
  };
}

