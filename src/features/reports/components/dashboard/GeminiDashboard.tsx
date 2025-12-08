import React, { useEffect, useState } from 'react';
import ApexCharts from 'apexcharts';
import axios from 'axios';
import './styles.css';

interface KPICardProps {
  title: string;
  value: number | string;
  icon: string;
  trend?: number;
}

// مكون بطاقات KPI
const KPICard: React.FC<KPICardProps> = ({ title, value, icon, trend }) => (
  <div className="glass-card kpi-card float-animation">
    <i className={`fas ${icon} fa-2x`}></i>
    <h3>{title}</h3>
    <div className="kpi-value">{value}</div>
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

  const handleSendMessage = () => {
    if (message.trim() !== '') {
      onSendMessage(message);
      setMessages([...messages, { text: message, sender: 'user' }]);
      setMessage('');
    }
  };

  return (
    <div className="chat-window">
      <div className="chat-header">
        <h3>Gemini AI المساعد</h3>
      </div>
      <div className="chat-messages">
        {messages.map((msg, idx) => (
          <div key={idx} className={`message ${msg.sender}`}>
            {msg.text}
          </div>
        ))}
      </div>
      <div className="chat-input">
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="اكتب سؤالك هنا..."
        />
        <button 
          onClick={handleSendMessage}
          aria-label="إرسال الرسالة"
          title="إرسال"
        >
          <i className="fas fa-paper-plane" aria-hidden="true"></i>
          <span className="sr-only">إرسال</span>
        </button>
      </div>
    </div>
  );
};

interface DashboardData {
  totalRevenue: number;
  netProfit: number;
  revenueTrend: number;
  profitTrend: number;
  revenue: number[];
  costs: number[];
}

// المكون الرئيسي للوحة القيادة
const GeminiDashboard: React.FC = () => {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await axios.get('/api/wardah/financial/dashboard');
        setData(response.data);
        initializeCharts(response.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'حدث خطأ غير معروف');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const initializeCharts = (data: DashboardData) => {
    // تهيئة الشارت الخطي
    new ApexCharts(document.querySelector("#revenue-chart"), {
      // إعدادات الشارت
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
        data: data.revenue
      }],
      // المزيد من الإعدادات...
    }).render();

    // تهيئة شارت الدائرة
    new ApexCharts(document.querySelector("#cost-distribution"), {
      chart: {
        type: 'donut',
        height: 350,
        background: 'transparent'
      },
      series: data.costs,
      labels: ['تكاليف مباشرة', 'تكاليف غير مباشرة', 'مصاريف إدارية'],
      // المزيد من الإعدادات...
    }).render();
  };

  if (loading) return <div className="loading-indicator">جاري التحميل...</div>;
  if (error) return <div className="alert error">{error}</div>;

  return (
    <div className="dashboard-container">
      <div id="particles-js"></div>
      
      <div className="kpi-container">
        <KPICard
          title="إجمالي المبيعات"
          value={data?.totalRevenue ?? 0}
          icon="fa-chart-line"
          trend={data?.revenueTrend}
        />
        <KPICard
          title="صافي الربح"
          value={data?.netProfit ?? 0}
          icon="fa-coins"
          trend={data?.profitTrend}
        />
        {/* المزيد من البطاقات... */}
      </div>

      <div className="charts-grid">
        <div className="chart-container">
          <div id="revenue-chart"></div>
        </div>
        <div className="chart-container">
          <div id="cost-distribution"></div>
        </div>
      </div>

      <ChatWindow onSendMessage={async (message: string) => {
        try {
          await axios.post('/api/wardah/gemini/chat', { message });
          // معالجة الرد يمكن إضافتها لاحقاً
        } catch (err) {
          setError(err instanceof Error ? err.message : 'خطأ في الاتصال بـ Gemini AI');
        }
      }} />

      <div className="control-buttons">
        <button 
          className="control-button"
          aria-label="تحديث البيانات"
          title="تحديث البيانات"
        >
          <i className="fas fa-sync" aria-hidden="true"></i>
          <span>تحديث البيانات</span>
        </button>
        <button 
          className="control-button"
          aria-label="تصدير التقرير"
          title="تصدير التقرير"
        >
          <i className="fas fa-file-export" aria-hidden="true"></i>
          <span>تصدير التقرير</span>
        </button>
        {/* المزيد من الأزرار... */}
      </div>
    </div>
  );
};

export default GeminiDashboard;