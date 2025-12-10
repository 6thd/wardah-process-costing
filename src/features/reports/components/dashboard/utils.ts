import axios from 'axios';
import { DashboardData, ChatMessage } from './types';

// تهيئة الجسيمات
export const initializeParticles = () => {
  if (typeof globalThis.window !== 'undefined' && (globalThis.window as any).particlesJS) {
    (globalThis.window as any).particlesJS('particles-js', {
      particles: {
        number: {
          value: 80,
          density: {
            enable: true,
            value_area: 800
          }
        },
        color: {
          value: '#ffffff'
        },
        opacity: {
          value: 0.5,
          random: false
        },
        size: {
          value: 3,
          random: true
        },
        line_linked: {
          enable: true,
          distance: 150,
          color: '#ffffff',
          opacity: 0.4,
          width: 1
        },
        move: {
          enable: true,
          speed: 3,
          direction: 'none',
          random: false,
          straight: false,
          out_mode: 'out',
          bounce: false
        }
      },
      interactivity: {
        detect_on: 'canvas',
        events: {
          onhover: {
            enable: true,
            mode: 'repulse'
          },
          onclick: {
            enable: true,
            mode: 'push'
          },
          resize: true
        }
      },
      retina_detect: true
    });
  }
};

// جلب بيانات لوحة القيادة
export const fetchDashboardData = async (): Promise<DashboardData> => {
  try {
    const response = await axios.get('/api/wardah/financial/dashboard');
    return response.data;
  } catch (error) {
    throw new Error('فشل في جلب بيانات لوحة القيادة');
  }
};

// إرسال رسالة إلى Gemini AI
export const sendGeminiMessage = async (message: string): Promise<ChatMessage> => {
  try {
    const response = await axios.post('/api/wardah/gemini/chat', { message });
    return {
      text: response.data.reply,
      sender: 'bot'
    };
  } catch (error) {
    throw new Error('فشل في الاتصال بـ Gemini AI');
  }
};

// تنسيق الأرقام
export const formatNumber = (value: number): string => {
  return new Intl.NumberFormat('ar-SA', {
    style: 'currency',
    currency: 'SAR'
  }).format(value);
};

// تحويل البيانات إلى تنسيق الرسم البياني
export const transformChartData = (data: DashboardData) => {
  return {
    revenue: {
      options: {
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
        xaxis: {
          categories: ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']
        },
        theme: {
          mode: 'dark'
        }
      }
    },
    costs: {
      options: {
        chart: {
          type: 'donut',
          height: 350,
          background: 'transparent'
        },
        series: data.costs,
        labels: ['تكاليف مباشرة', 'تكاليف غير مباشرة', 'مصاريف إدارية'],
        theme: {
          mode: 'dark'
        }
      }
    }
  };
};