import { useNavigate } from 'react-router-dom';
import { LogOut, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuShortcut,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { getGlassClasses } from '@/lib/wardah-ui-utils';
import { AccountManagementItems, OrganizationItems, ActivityItems } from './HeaderUserMenuItems';

interface User {
  email?: string;
  user_metadata?: {
    full_name?: string;
    avatar_url?: string;
  };
}

interface HeaderUserMenuProps {
  user: User | null;
  onLogout: () => void;
  isRTL: boolean;
}

export function HeaderUserMenu({ user, onLogout, isRTL }: HeaderUserMenuProps) {
  const navigate = useNavigate();
  const userFullName = (user as any)?.user_metadata?.full_name || user?.email?.split('@')[0] || 'مستخدم';
  const userEmail = user?.email || '';
  const userAvatarFallback = userFullName?.charAt(0)?.toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-9 px-2 hover:bg-accent/50 transition-colors">
          <Avatar className="h-7 w-7 ring-2 ring-primary/20">
            <AvatarImage src={(user as any)?.user_metadata?.avatar_url || undefined} />
            <AvatarFallback className="text-xs bg-gradient-to-br from-primary to-primary/60 text-primary-foreground">
              {userAvatarFallback}
            </AvatarFallback>
          </Avatar>
          <span className={cn(
            "hidden md:inline-block text-sm font-medium",
            isRTL ? "mr-2" : "ml-2"
          )}>
            {userFullName}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={isRTL ? "start" : "end"}
        className={cn("w-72", getGlassClasses())}
        sideOffset={8}
      >
        <DropdownMenuLabel className="p-4">
          <div className={cn("flex items-center gap-3", isRTL ? "flex-row-reverse" : "")}>
            <Avatar className="h-12 w-12 ring-2 ring-primary/30">
              <AvatarImage src={(user as any)?.user_metadata?.avatar_url || undefined} />
              <AvatarFallback className="text-lg bg-gradient-to-br from-primary to-primary/60 text-primary-foreground">
                {userAvatarFallback}
              </AvatarFallback>
            </Avatar>
            <div className={cn("flex flex-col", isRTL ? "items-end" : "items-start")}>
              <span className="font-semibold text-base">{userFullName}</span>
              <span className="text-xs text-muted-foreground">{userEmail}</span>
              <Badge variant="secondary" className="mt-1 text-[10px]">
                <Shield className="h-3 w-3 mr-1" />
                {isRTL ? 'مسؤول المنظمة' : 'Org Admin'}
              </Badge>
            </div>
          </div>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <AccountManagementItems isRTL={isRTL} navigate={navigate} />

        <DropdownMenuSeparator />

        <OrganizationItems isRTL={isRTL} navigate={navigate} />

        <DropdownMenuSeparator />

        <ActivityItems isRTL={isRTL} navigate={navigate} />

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onClick={onLogout}
          className={cn(
            "cursor-pointer text-destructive focus:text-destructive focus:bg-destructive/10",
            isRTL ? "flex-row-reverse" : ""
          )}
        >
          <LogOut className={cn("h-4 w-4", isRTL ? "ml-2" : "mr-2")} />
          <span className="flex-1">{isRTL ? 'تسجيل الخروج' : 'Sign Out'}</span>
          <DropdownMenuShortcut>⇧⌘Q</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

