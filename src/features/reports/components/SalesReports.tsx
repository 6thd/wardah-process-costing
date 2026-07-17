/**
 * Sales Reports Component
 * مكون تقارير المبيعات
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TrendingUp, Users, Package, DollarSign } from 'lucide-react';
import { useSalesReportsData } from './hooks/useSalesReportsData';
import { exportToExcel, exportToPDF } from './utils/salesReportsExport';
import { SalesReportsDateFilter } from './SalesReportsDateFilter';
import { SalesPerformanceTab } from './tabs/SalesPerformanceTab';
import { CustomerAnalysisTab } from './tabs/CustomerAnalysisTab';
import { ProductAnalysisTab } from './tabs/ProductAnalysisTab';
import { ProfitabilityTab } from './tabs/ProfitabilityTab';

export function SalesReports() {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';

  const [fromDate, setFromDate] = useState<Date | undefined>(() => {
    const date = new Date();
    date.setMonth(date.getMonth() - 1);
    return date;
  });
  const [toDate, setToDate] = useState<Date | undefined>(new Date());
  const [activeTab, setActiveTab] = useState('performance');

  const {
    loading,
    performance,
    customerAnalysis,
    productAnalysis,
    profitability,
    fetchData
  } = useSalesReportsData({ fromDate, toDate, activeTab });

  const handleExportExcel = () => {
    exportToExcel({
      activeTab,
      isRTL,
      performance,
      customerAnalysis,
      productAnalysis,
      profitability
    });
  };

  const handleExportPDF = () => {
    exportToPDF({
      activeTab,
      isRTL,
      performance,
      customerAnalysis,
      productAnalysis,
      profitability
    });
  };

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className={cn("flex items-center justify-between", isRTL ? "flex-row-reverse" : "")}>
        <div>
          <h1 className="text-3xl font-bold">
            {t('salesReports.title')}
          </h1>
          <p className="text-muted-foreground mt-2">
            {t('salesReports.subtitle')}
          </p>
        </div>
      </div>

      <SalesReportsDateFilter
        fromDate={fromDate}
        toDate={toDate}
        onFromDateChange={setFromDate}
        onToDateChange={setToDate}
        onViewClick={fetchData}
        onExportExcel={handleExportExcel}
        onExportPDF={handleExportPDF}
        loading={loading}
        isRTL={isRTL}
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="performance">
            <TrendingUp className="h-4 w-4 mr-2" />
            {t('salesReports.tabs.performance')}
          </TabsTrigger>
          <TabsTrigger value="customers">
            <Users className="h-4 w-4 mr-2" />
            {t('salesReports.tabs.customers')}
          </TabsTrigger>
          <TabsTrigger value="products">
            <Package className="h-4 w-4 mr-2" />
            {t('salesReports.tabs.products')}
          </TabsTrigger>
          <TabsTrigger value="profitability">
            <DollarSign className="h-4 w-4 mr-2" />
            {t('salesReports.tabs.profitability')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="performance">
          <SalesPerformanceTab loading={loading} performance={performance} />
        </TabsContent>

        <TabsContent value="customers">
          <CustomerAnalysisTab loading={loading} customerAnalysis={customerAnalysis} isRTL={isRTL} />
        </TabsContent>

        <TabsContent value="products">
          <ProductAnalysisTab loading={loading} productAnalysis={productAnalysis} isRTL={isRTL} />
        </TabsContent>

        <TabsContent value="profitability">
          <ProfitabilityTab loading={loading} profitability={profitability} isRTL={isRTL} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

