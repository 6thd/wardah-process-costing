import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
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
}

export function useSalesReportsData({ fromDate, toDate, activeTab }: UseSalesReportsDataProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [performance, setPerformance] = useState<SalesPerformanceMetrics | null>(null);
  const [customerAnalysis, setCustomerAnalysis] = useState<CustomerSalesAnalysis[]>([]);
  const [productAnalysis, setProductAnalysis] = useState<ProductSalesAnalysis[]>([]);
  const [profitability, setProfitability] = useState<ProfitabilityAnalysis | null>(null);

  const fetchData = async () => {
    if (!fromDate || !toDate) {
      toast.error(t('salesReports.selectDates'));
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
      toast.error(error.message || t('salesReports.fetchError'));
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

