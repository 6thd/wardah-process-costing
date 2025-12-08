import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { getGlassClasses } from '@/lib/wardah-ui-utils';
import { useTranslation } from 'react-i18next';

interface Notification {
  id: string;
  title: string;
  message: string;
  type: 'success' | 'error' | 'warning' | 'info';
  read: boolean;
}

interface HeaderNotificationsProps {
  notifications: Notification[];
  isRTL: boolean;
}

export function HeaderNotifications({ notifications, isRTL }: HeaderNotificationsProps) {
  const { t } = useTranslation();
  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-9 w-9 p-0 relative">
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <Badge className={cn(
              "absolute h-5 w-5 rounded-full p-0 text-xs",
              isRTL ? "-left-1 -top-1" : "-right-1 -top-1"
            )}>
              {unreadCount > 9 ? '9+' : unreadCount}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={isRTL ? "start" : "end"} className={cn("w-80", getGlassClasses())}>
        <DropdownMenuLabel className={isRTL ? "text-right" : "text-left"}>
          {t('dashboard.recentActivities')}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {notifications.length === 0 ? (
          <div className={cn(
            "p-4 text-center text-muted-foreground",
            isRTL ? "text-right" : "text-left"
          )}>
            {t('messages.noDataFound')}
          </div>
        ) : (
          notifications.slice(0, 5).map((notification) => (
            <DropdownMenuItem key={notification.id} className={cn(
              "flex-col items-start p-3",
              isRTL ? "text-right" : "text-left"
            )}>
              <div className={cn(
                "flex items-center gap-2 w-full",
                isRTL ? "flex-row-reverse" : "flex-row"
              )}>
                <div className={`w-2 h-2 rounded-full ${
                  (() => {
                    if (notification.type === 'success') return 'bg-success';
                    if (notification.type === 'error') return 'bg-destructive';
                    if (notification.type === 'warning') return 'bg-warning';
                    return 'bg-info';
                  })()
                }`} />
                <span className="font-medium text-sm">{notification.title}</span>
                {!notification.read && (
                  <div className={cn(
                    "w-2 h-2 bg-primary rounded-full",
                    isRTL ? "mr-auto" : "ml-auto"
                  )} />
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {notification.message}
              </p>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

