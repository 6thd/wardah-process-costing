import { useNavigate } from 'react-router-dom';
import {
  User, UserCog, KeyRound, Building2, Shield, Settings,
  History, Smartphone, HelpCircle
} from 'lucide-react';
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuGroup,
  DropdownMenuShortcut,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

interface HeaderUserMenuItemsProps {
  isRTL: boolean;
  navigate: ReturnType<typeof useNavigate>;
}

export function AccountManagementItems({ isRTL, navigate }: HeaderUserMenuItemsProps) {
  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel className={cn("text-xs text-muted-foreground px-2", isRTL ? "text-right" : "")}>
        {isRTL ? 'إدارة الحساب' : 'Account Management'}
      </DropdownMenuLabel>

      <DropdownMenuItem
        onClick={() => navigate('/settings/profile')}
        className={cn("cursor-pointer", isRTL ? "flex-row-reverse" : "")}
      >
        <User className={cn("h-4 w-4", isRTL ? "ml-2" : "mr-2")} />
        <span className="flex-1">{isRTL ? 'الملف الشخصي' : 'My Profile'}</span>
        <DropdownMenuShortcut>⌘P</DropdownMenuShortcut>
      </DropdownMenuItem>

      <DropdownMenuItem
        onClick={() => navigate('/settings/preferences')}
        className={cn("cursor-pointer", isRTL ? "flex-row-reverse" : "")}
      >
        <UserCog className={cn("h-4 w-4", isRTL ? "ml-2" : "mr-2")} />
        <span className="flex-1">{isRTL ? 'تفضيلات الحساب' : 'Preferences'}</span>
      </DropdownMenuItem>

      <DropdownMenuItem
        onClick={() => navigate('/settings/security')}
        className={cn("cursor-pointer", isRTL ? "flex-row-reverse" : "")}
      >
        <KeyRound className={cn("h-4 w-4", isRTL ? "ml-2" : "mr-2")} />
        <span className="flex-1">{isRTL ? 'الأمان وكلمة المرور' : 'Security'}</span>
      </DropdownMenuItem>
    </DropdownMenuGroup>
  );
}

export function OrganizationItems({ isRTL, navigate }: HeaderUserMenuItemsProps) {
  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel className={cn("text-xs text-muted-foreground px-2", isRTL ? "text-right" : "")}>
        {isRTL ? 'إدارة المنظمة' : 'Organization'}
      </DropdownMenuLabel>

      <DropdownMenuItem
        onClick={() => navigate('/org-admin/users')}
        className={cn("cursor-pointer", isRTL ? "flex-row-reverse" : "")}
      >
        <Building2 className={cn("h-4 w-4", isRTL ? "ml-2" : "mr-2")} />
        <span className="flex-1">{isRTL ? 'إدارة المستخدمين' : 'Manage Users'}</span>
      </DropdownMenuItem>

      <DropdownMenuItem
        onClick={() => navigate('/org-admin/roles')}
        className={cn("cursor-pointer", isRTL ? "flex-row-reverse" : "")}
      >
        <Shield className={cn("h-4 w-4", isRTL ? "ml-2" : "mr-2")} />
        <span className="flex-1">{isRTL ? 'الأدوار والصلاحيات' : 'Roles & Permissions'}</span>
      </DropdownMenuItem>

      <DropdownMenuItem
        onClick={() => navigate('/settings')}
        className={cn("cursor-pointer", isRTL ? "flex-row-reverse" : "")}
      >
        <Settings className={cn("h-4 w-4", isRTL ? "ml-2" : "mr-2")} />
        <span className="flex-1">{isRTL ? 'الإعدادات' : 'Settings'}</span>
        <DropdownMenuShortcut>⌘S</DropdownMenuShortcut>
      </DropdownMenuItem>
    </DropdownMenuGroup>
  );
}

export function ActivityItems({ isRTL, navigate }: HeaderUserMenuItemsProps) {
  return (
    <DropdownMenuGroup>
      <DropdownMenuItem
        onClick={() => navigate('/activity-log')}
        className={cn("cursor-pointer", isRTL ? "flex-row-reverse" : "")}
      >
        <History className={cn("h-4 w-4", isRTL ? "ml-2" : "mr-2")} />
        <span className="flex-1">{isRTL ? 'سجل النشاط' : 'Activity Log'}</span>
      </DropdownMenuItem>

      <DropdownMenuItem
        onClick={() => navigate('/active-sessions')}
        className={cn("cursor-pointer", isRTL ? "flex-row-reverse" : "")}
      >
        <Smartphone className={cn("h-4 w-4", isRTL ? "ml-2" : "mr-2")} />
        <span className="flex-1">{isRTL ? 'الجلسات النشطة' : 'Active Sessions'}</span>
      </DropdownMenuItem>

      <DropdownMenuItem
        onClick={() => globalThis.window?.open('https://docs.wardah.sa', '_blank')}
        className={cn("cursor-pointer", isRTL ? "flex-row-reverse" : "")}
      >
        <HelpCircle className={cn("h-4 w-4", isRTL ? "ml-2" : "mr-2")} />
        <span className="flex-1">{isRTL ? 'المساعدة والدعم' : 'Help & Support'}</span>
      </DropdownMenuItem>
    </DropdownMenuGroup>
  );
}

