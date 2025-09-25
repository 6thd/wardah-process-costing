// src/components/ConnectionStatus.tsx
import React, { useState, useEffect } from 'react';
import { Wifi, WifiOff, AlertCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase';

export const ConnectionStatus: React.FC = () => {
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('connecting');
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [reconnectAttempts, setReconnectAttempts] = useState(0);

  useEffect(() => {
    let reconnectTimer: NodeJS.Timeout;
    
    // Connection monitoring
    const checkConnection = async () => {
      try {
        if (!supabase) {
          setStatus('error');
          return;
        }
        
        const { error } = await supabase.from('organizations').select('id').limit(1);
        
        if (error) {
          setStatus('error');
          console.error('Connection error:', error);
        } else {
          setStatus('connected');
          setLastUpdate(new Date());
          setReconnectAttempts(0);
        }
      } catch (err) {
        setStatus('disconnected');
        setReconnectAttempts(prev => prev + 1);
        
        // Reconnection attempt
        if (reconnectAttempts < 5) {
          reconnectTimer = setTimeout(checkConnection, 5000 * Math.pow(2, reconnectAttempts));
        }
      }
    };

    // Initial check
    checkConnection();
    
    // Periodic check every 30 seconds
    const interval = setInterval(checkConnection, 30000);

    return () => {
      clearInterval(interval);
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [reconnectAttempts]);

  const getStatusConfig = () => {
    switch (status) {
      case 'connected':
        return {
          icon: <Wifi className="w-4 h-4" />,
          text: 'متصل',
          variant: 'default' as const,
          className: 'bg-green-500 text-white'
        };
      case 'connecting':
        return {
          icon: <Wifi className="w-4 h-4 animate-pulse" />,
          text: 'جارٍ الاتصال...',
          variant: 'secondary' as const,
          className: 'bg-yellow-500 text-white'
        };
      case 'disconnected':
        return {
          icon: <WifiOff className="w-4 h-4" />,
          text: `منقطع (${reconnectAttempts}/5)`,
          variant: 'destructive' as const,
          className: 'bg-red-500 text-white'
        };
      case 'error':
        return {
          icon: <AlertCircle className="w-4 h-4" />,
          text: 'خطأ في الاتصال',
          variant: 'destructive' as const,
          className: 'bg-red-600 text-white'
        };
    }
  };

  const config = getStatusConfig();

  return (
    <div className="flex items-center gap-2">
      <Badge variant={config.variant} className={`${config.className} flex items-center gap-2`}>
        {config.icon}
        {config.text}
      </Badge>
      
      {status === 'connected' && (
        <span className="text-xs text-muted-foreground">
          آخر تحديث: {lastUpdate.toLocaleTimeString('ar-SA')}
        </span>
      )}
    </div>
  );
};