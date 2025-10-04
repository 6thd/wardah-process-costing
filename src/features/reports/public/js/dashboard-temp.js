// تحميل البيانات من API
async function fetchData() {
  try {
    const [kpisResponse, chartsResponse] = await Promise.all([
      fetch('/api/data/kpis'),
      fetch('/api/data/charts')
    ]);

    const kpisData = await kpisResponse.json();
    const chartsData = await chartsResponse.json();

    createKPICards(kpisData);
    initializeCharts(chartsData);
    loadUpdatesAndInsights();
  } catch (error) {
    console.error('خطأ في تحميل البيانات:', error);
    showError('حدث خطأ أثناء تحميل البيانات. يرجى المحاولة مرة أخرى.');
  }
}

// تحميل التحديثات والتحليلات
async function loadUpdatesAndInsights() {
  try {
    const [updatesResponse, insightsResponse] = await Promise.all([
      fetch('/api/data/updates'),
      fetch('/api/data/insights')
    ]);

    const updates = await updatesResponse.json();
    const insights = await insightsResponse.json();

    displayUpdates(updates);
    displayInsights(insights);
  } catch (error) {
    console.error('خطأ في تحميل التحديثات والتحليلات:', error);
  }
}

// إنشاء بطاقات KPI
function createKPICards(data) {
  const container = document.querySelector('.kpi-container');
  const cards = [
    {
      title: 'إجمالي المبيعات',
      value: formatCurrency(data.totalRevenue),
      icon: 'fa-chart-line',
      trend: data.revenueTrend
    },
    {
      title: 'صافي الربح',
      value: formatCurrency(data.netProfit),
      icon: 'fa-coins',
      trend: data.profitTrend
    },
    {
      title: 'كفاءة التكاليف',
      value: data.costEfficiency + '%',
      icon: 'fa-chart-pie',
      trend: 0
    },
    {
      title: 'كفاءة التشغيل',
      value: data.operationalEfficiency + '%',
      icon: 'fa-cogs',
      trend: 0
    }
  ];

  container.innerHTML = cards.map(card => `
    <div class="glass-card kpi-card float-animation">
      <i class="fas ${card.icon} fa-2x"></i>
      <h3>${card.title}</h3>
      <div class="kpi-value">${card.value}</div>
      ${card.trend !== 0 ? `
        <div class="trend ${card.trend > 0 ? 'positive' : 'negative'}">
          <i class="fas fa-arrow-${card.trend > 0 ? 'up' : 'down'}"></i>
          ${Math.abs(card.trend)}%
        </div>
      ` : ''}
    </div>
  `).join('');
}

// تهيئة الرسوم البيانية
function initializeCharts(data) {
  // الرسم الخطي للمبيعات
  new ApexCharts(document.querySelector("#revenue-chart"), {
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
      data: data.revenue.data
    }],
    xaxis: {
      categories: data.revenue.labels,
      labels: {
        style: {
          colors: '#ffffff'
        }
      }
    },
    yaxis: {
      labels: {
        style: {
          colors: '#ffffff'
        },
        formatter: (value) => formatCurrency(value)
      }
    },
    theme: {
      mode: 'dark'
    }
  }).render();

  // شارت توزيع التكاليف
  new ApexCharts(document.querySelector("#cost-distribution"), {
    chart: {
      type: 'donut',
      height: 350,
      background: 'transparent'
    },
    series: data.costs.data,
    labels: data.costs.labels,
    theme: {
      mode: 'dark'
    },
    responsive: [{
      breakpoint: 480,
      options: {
        chart: {
          width: 200
        },
        legend: {
          position: 'bottom'
        }
      }
    }]
  }).render();

  // شارت مؤشرات الكفاءة
  new ApexCharts(document.querySelector("#efficiency-metrics"), {
    chart: {
      type: 'radar',
      height: 350,
      background: 'transparent'
    },
    series: [{
      name: 'الكفاءة',
      data: data.efficiency.data
    }],
    labels: data.efficiency.labels,
    theme: {
      mode: 'dark'
    }
  }).render();
}

// عرض التحديثات
function displayUpdates(updates) {
  const container = document.querySelector('.updates-container');
  container.innerHTML = updates.map(update => `
    <div class="update-item ${update.type}">
      <div class="update-time">${new Date(update.timestamp).toLocaleTimeString('ar-SA')}</div>
      <div class="update-message">${update.message}</div>
    </div>
  `).join('');
}

// عرض التحليلات
function displayInsights(insights) {
  const container = document.querySelector('.insights-container');
  container.innerHTML = insights.map(insight => `
    <div class="insight-card glass-card">
      <div class="insight-header">
        <h4>${insight.title}</h4>
        <span class="impact-badge ${insight.impact}">${insight.impact}</span>
      </div>
      <p>${insight.description}</p>
      <div class="insight-category">${insight.category}</div>
    </div>
  `).join('');
}

// تنسيق العملة
function formatCurrency(value) {
  return new Intl.NumberFormat('ar-SA', {
    style: 'currency',
    currency: 'SAR'
  }).format(value);
}

// عرض رسالة خطأ
function showError(message) {
  const errorDiv = document.createElement('div');
  errorDiv.className = 'error-message';
  errorDiv.textContent = message;
  document.body.appendChild(errorDiv);
  setTimeout(() => errorDiv.remove(), 5000);
}

// تحميل البيانات عند تحميل الصفحة
document.addEventListener('DOMContentLoaded', fetchData);