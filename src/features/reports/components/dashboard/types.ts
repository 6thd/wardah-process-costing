export interface KPICardProps {
  title: string;
  value: number | string;
  icon: string;
  trend?: number;
}

export interface ChatMessage {
  text: string;
  sender: 'user' | 'bot';
}

export interface ChatWindowProps {
  onSendMessage: (message: string) => Promise<void>;
}

export interface DashboardData {
  totalRevenue: number;
  netProfit: number;
  revenueTrend: number;
  profitTrend: number;
  revenue: number[];
  costs: number[];
}

export interface ChartOptions {
  chart: {
    type: string;
    height: number;
    background: string;
    animations?: {
      enabled: boolean;
      easing: string;
      speed: number;
    };
  };
  series: Array<{
    name?: string;
    data: number[];
  }> | number[];
  labels?: string[];
  [key: string]: any;
}