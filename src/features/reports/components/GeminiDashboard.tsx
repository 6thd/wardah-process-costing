import React, { useEffect, useState, useRef } from 'react';
import ApexCharts from 'apexcharts';
import axios from 'axios';
import { useWardahTheme } from '@/components/wardah-theme-provider';

// Interfaces for financial data
interface FinancialKPIs {
  totalSales: number;
  totalCosts: number;
  netProfit: number;
  grossProfit: number;
  inventoryValue: number;
  totalAssets: number;
  totalLiabilities: number;
  equity: number;
  profitMargin: number;
  revenueGrowth: number;
  operationalEfficiency: number;
}

interface ChartData {
  revenue: number[];
  costs: number[];
  profit: number[];
  months: string[];
}

interface DashboardData {
  kpis: FinancialKPIs;
  charts: ChartData;
  recentTransactions: any[];
  topProducts: any[];
}

interface KPICardProps {
  title: string;
  value: number | string;
  icon: string;
  trend?: number;
}

// مكون بطاقات KPI
const KPICard: React.FC<KPICardProps> = ({ title, value, icon, trend }) => (
  <div className="wardah-kpi-card wardah-animation-float">
    <i className={`fas ${icon} fa-2x wardah-text-gradient-google`}></i>
    <h3>{title}</h3>
    <div className="kpi-value wardah-text-gradient-google">{value}</div>
    {!!trend && (
      <div className={`trend ${trend > 0 ? 'positive' : 'negative'}`}>
        <i className={`fas fa-arrow-${trend > 0 ? 'up' : 'down'}`}></i>
        {Math.abs(trend)}%
      </div>
    )}
  </div>
);

interface ChatMessage {
  text: string;
  sender: 'user' | 'ai';
}

interface ChatWindowProps {
  onSendMessage: (message: string) => Promise<void>;
}

// مكون نافذة الدردشة
const ChatWindow: React.FC<ChatWindowProps> = ({ onSendMessage }) => {
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const handleSend = () => {
    if (message.trim() !== '') {
      onSendMessage(message);
      setMessages([...messages, { text: message, sender: 'user' }]);
      setMessage('');
    }
  };

  return (
    <div className="wardah-chat-container">
      <div className="chat-messages" id="chatMessages">
        {messages.map((msg, index) => (
          <div key={index} className={`chat-message ${msg.sender}`}>
            <div className="message-content">
              {msg.text}
            </div>
          </div>
        ))}
      </div>
      <div className="chat-input-container">
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="اسأل Gemini AI عن بياناتك المالية..."
          className="chat-input"
          onKeyPress={(e) => e.key === 'Enter' && handleSend()}
        />
        <button 
          onClick={handleSend} 
          className="send-button"
          aria-label="إرسال الرسالة"
        >
          <i className="fas fa-paper-plane" aria-hidden="true"></i>
        </button>
      </div>
    </div>
  );
};

// مكون لوحة التحكم الرئيسية
const GeminiDashboard: React.FC = () => {
  const { theme } = useWardahTheme();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const revenueChartRef = useRef<HTMLDivElement>(null);
  const costDistributionRef = useRef<HTMLDivElement>(null);
  const chartsInitializedRef = useRef(false);
  const chartInstancesRef = useRef<any[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);
        
        // Fetch real financial data from the API
        const response = await axios.get('/api/data/financial/dashboard');
        const dashboardData: DashboardData = response.data;
        
        setData(dashboardData);
      } catch (err) {
        console.error('Error fetching dashboard data:', err);
        setError(err instanceof Error ? err.message : 'حدث خطأ غير معروف');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  // Cleanup charts on unmount
  useEffect(() => {
    return () => {
      // Destroy chart instances to prevent memory leaks
      chartInstancesRef.current.forEach(chart => {
        if (chart && typeof chart.destroy === 'function') {
          chart.destroy();
        }
      });
      chartInstancesRef.current = [];
    };
  }, []);

  // Effect to initialize charts after data is loaded and DOM is ready
  useEffect(() => {
    if (data && !chartsInitializedRef.current) {
      let retryCount = 0;
      const maxRetries = 5;
      
      const attemptInitializeCharts = () => {
        if (initializeCharts(data)) {
          chartsInitializedRef.current = true;
        } else if (retryCount < maxRetries) {
          retryCount++;
          setTimeout(attemptInitializeCharts, 200);
        }
      };
      
      // Initial attempt after a small delay to ensure DOM is rendered
      const timer = setTimeout(attemptInitializeCharts, 100);
      
      return () => clearTimeout(timer);
    }
  }, [data]);

  const initializeCharts = (data: DashboardData) => {
    // Check if the chart elements exist in the DOM
    if (revenueChartRef.current && costDistributionRef.current) {
      // Ensure elements are actually mounted in the DOM
      if (!document.contains(revenueChartRef.current) || 
          !document.contains(costDistributionRef.current)) {
        return false;
      }
      
      // Clean up any existing charts
      if (revenueChartRef.current.innerHTML) {
        revenueChartRef.current.innerHTML = '';
      }
      if (costDistributionRef.current.innerHTML) {
        costDistributionRef.current.innerHTML = '';
      }
      
      // تهيئة الشارت الخطي
      const revenueChart = new ApexCharts(revenueChartRef.current, {
        chart: {
          type: 'line',
          height: 350,
          background: 'transparent',
          animations: {
            enabled: true,
            easing: 'easeinout',
            speed: 800
          }
        },
        series: [{
          name: 'المبيعات',
          data: data.charts.revenue
        }, {
          name: 'التكاليف',
          data: data.charts.costs
        }, {
          name: 'الأرباح',
          data: data.charts.profit
        }],
        xaxis: {
          categories: data.charts.months
        },
        stroke: {
          curve: 'smooth',
          width: 3
        },
        colors: ['#4285f4', '#ea4335', '#34a853'],
        tooltip: {
          theme: 'dark'
        }
      });
      
      revenueChart.render();
      chartInstancesRef.current.push(revenueChart);

      // تهيئة شارت الدائرة
      const costDistributionChart = new ApexCharts(costDistributionRef.current, {
        chart: {
          type: 'donut',
          height: 350,
          background: 'transparent'
        },
        series: [data.kpis.totalSales, data.kpis.totalCosts, data.kpis.netProfit],
        labels: ['المبيعات', 'التكاليف', 'الأرباح'],
        colors: ['#4285f4', '#ea4335', '#34a853'],
        legend: {
          position: 'bottom'
        }
      });
      
      costDistributionChart.render();
      chartInstancesRef.current.push(costDistributionChart);
      
      return true;
    }
    
    return false;
  };

  const handleSendMessage = async (message: string) => {
    try {
      // هنا يمكنك إرسال الرسالة إلى Gemini AI مع البيانات المالية
      console.log('Sending message to Gemini AI:', message);
      // Implementation would depend on your Gemini API integration
    } catch (error) {
      console.error('Error sending message:', error);
    }
  };

  const formatCurrency = (value: number): string => {
    return new Intl.NumberFormat('ar-SA', {
      style: 'currency',
      currency: 'SAR'
    }).format(value);
  };

  if (loading) {
    return (
      <div className="dashboard-container">
        <div className="loading-state">
          <div className="spinner"></div>
          <p>جاري تحميل بيانات لوحة التحكم...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="dashboard-container">
        <div className="error-state">
          <div className="error-icon">
            <i className="fas fa-exclamation-triangle"></i>
          </div>
          <h3>حدث خطأ في تحميل البيانات</h3>
          <p>{error}</p>
          <button 
            className="retry-button"
            onClick={() => window.location.reload()}
          >
            إعادة المحاولة
          </button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="dashboard-container">
        <div className="empty-state">
          <div className="empty-icon">
            <i className="fas fa-chart-bar"></i>
          </div>
          <h3>لا توجد بيانات متاحة</h3>
          <p>لا توجد بيانات مالية لعرضها حالياً</p>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-container wardah-gradient-dark-background" dir="rtl">
      {/* بطاقات KPIs */}
      <div className="kpi-grid">
        <KPICard 
          title="إجمالي المبيعات" 
          value={formatCurrency(data.kpis.totalSales)} 
          icon="fa-chart-line" 
          trend={data.kpis.revenueGrowth}
        />
        <KPICard 
          title="صافي الربح" 
          value={formatCurrency(data.kpis.netProfit)} 
          icon="fa-coins" 
          trend={data.kpis.profitMargin}
        />
        <KPICard 
          title="قيمة المخزون" 
          value={formatCurrency(data.kpis.inventoryValue)} 
          icon="fa-warehouse" 
        />
        <KPICard 
          title="كفاءة التشغيل" 
          value={`${data.kpis.operationalEfficiency.toFixed(1)}%`} 
          icon="fa-cogs" 
        />
      </div>

      {/* الرسوم البيانية */}
      <div className="charts-grid">
        <div className="wardah-chart-card">
          <h3>الأداء المالي على مدار الأشهر</h3>
          <div ref={revenueChartRef} id="revenue-chart" className="wardah-min-height-chart"></div>
        </div>
        
        <div className="wardah-chart-card">
          <h3>توزيع التكاليف والأرباح</h3>
          <div ref={costDistributionRef} id="cost-distribution" className="wardah-min-height-chart"></div>
        </div>
      </div>

      {/* المعاملات الأخيرة */}
      <div className="recent-transactions wardah-glass-card">
        <h3>أحدث المعاملات</h3>
        <div className="transactions-list">
          {data.recentTransactions.map((transaction) => (
            <div key={transaction.id} className="transaction-item">
              <div className="transaction-info">
                <div className="transaction-title">
                  طلبية مبيعات #{transaction.order_number}
                </div>
                <div className="transaction-customer">
                  {transaction.customer?.name || 'عميل غير محدد'}
                </div>
              </div>
              <div className="transaction-amount wardah-text-gradient-google">
                {formatCurrency(transaction.total_amount || 0)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* نافذة الدردشة مع Gemini AI */}
      <div className="chat-section">
        <div className="wardah-chat-container">
          <ChatWindow onSendMessage={handleSendMessage} />
        </div>
      </div>
    </div>
  );
};

export default GeminiDashboard;