import React, { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { VarianceAnalysisReport } from './VarianceAnalysisReport';
import { WIPReport } from './WIPReport';
import { ProfitabilityReport } from './ProfitabilityReport';
import GeminiDashboard from './GeminiDashboard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const ReportsDashboard: React.FC = () => {
  const [selectedMO, setSelectedMO] = useState<string>('');

  // Sample manufacturing orders for demo
  const sampleMOs = [
    { id: 'mo1', number: 'MO-2025-001', product: 'كريم ورد عطري' },
    { id: 'mo2', number: 'MO-2025-002', product: 'صابون زعتر طبيعي' },
    { id: 'mo3', number: 'MO-2025-003', product: 'زيت جوز الهند العضوي' }
  ];

  return (
    <div className="space-y-6">
      {/* Report Filters */}
      <Card className="wardah-glass-card">
        <CardHeader>
          <CardTitle className="text-right wardah-text-gradient-google">فلاتر التقارير</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col md:flex-row gap-4 items-end">
            <div className="w-full md:w-64">
              <label htmlFor="mo-select" className="block text-sm font-medium mb-1 text-right">اختر أمر التصنيع</label>
              <Select value={selectedMO} onValueChange={setSelectedMO}>
                <SelectTrigger id="mo-select" className="text-right">
                  <SelectValue placeholder="اختر أمر التصنيع" />
                </SelectTrigger>
                <SelectContent>
                  {sampleMOs.map((mo) => (
                    <SelectItem key={mo.id} value={mo.id} className="text-right">
                      {mo.number} - {mo.product}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            {/* We'll add date range picker later when we have the dependencies */}
            <div className="text-sm text-muted-foreground">
              * لتحديد نطاق التاريخ، يرجى استخدام الفلاتر المتقدمة
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Report Tabs */}
      <Tabs defaultValue="gemini" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4 lg:grid-cols-5 wardah-glass-card">
          <TabsTrigger value="gemini">لوحة التحكم المالية</TabsTrigger>
          <TabsTrigger value="variances">تحليل الانحرافات</TabsTrigger>
          <TabsTrigger value="wip">تقرير WIP</TabsTrigger>
          <TabsTrigger value="profitability">تحليل الربحية</TabsTrigger>
          <TabsTrigger value="inventory">تقييم المخزون</TabsTrigger>
        </TabsList>
        
        <TabsContent value="gemini" className="space-y-4">
          <GeminiDashboard />
        </TabsContent>
        
        <TabsContent value="variances" className="space-y-4">
          <VarianceAnalysisReport 
            manufacturingOrderId={selectedMO}
          />
        </TabsContent>
        
        <TabsContent value="wip" className="space-y-4">
          <WIPReport />
        </TabsContent>
        
        <TabsContent value="profitability" className="space-y-4">
          <ProfitabilityReport />
        </TabsContent>
        
        <TabsContent value="inventory" className="space-y-4">
          <Card className="wardah-glass-card">
            <CardHeader>
              <CardTitle className="text-right wardah-text-gradient-google">تقرير تقييم المخزون</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center py-8 text-muted-foreground">
                تقرير تقييم المخزون قيد التطوير
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};