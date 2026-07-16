import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  User, UserCog, KeyRound, Building2, Shield, Settings,
  History, Smartphone, HelpCircle
} from 'lucide-react';
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuGroup,
  DropdownMenuShortcut,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

interface HeaderUserMenuItemsProps {
  readonly isRTL: boolean;
  readonly navigate: ReturnType<typeof useNavigate>;
}

export function AccountManagementItems({ isRTL, navigate }: HeaderUserMenuItemsProps) {
  const { t } = useTranslation()
  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel className={cn("text-xs text-muted-foreground px-2", isRTL ? "text-right" : "")}>
        {t('userMenu.accountManagement')}
      </DropdownMenuLabel>

      <DropdownMenuItem
        onClick={() => navigate('/settings/profile')}
        className={cn("cursor-pointer", isRTL ? "flex-row-reverse" : "")}
      >
        <User className={cn("h-4 w-4", isRTL ? "ml-2" : "mr-2")} />
        <span className="flex-1">{t('userMenu.profile')}</span>
        <DropdownMenuShortcut>⌘P</DropdownMenuShortcut>
      </DropdownMenuItem>

      <DropdownMenuItem
        onClick={() => navigate('/settings/preferences')}
        className={cn("cursor-pointer", isRTL ? "flex-row-reverse" : "")}
      >
        <UserCog className={cn("h-4 w-4", isRTL ? "ml-2" : "mr-2")} />
        <span className="flex-1">{t('userMenu.preferences')}</span>
      </DropdownMenuItem>

      <DropdownMenuItem
        onClick={() => navigate('/settings/security')}
        className={cn("cursor-pointer", isRTL ? "flex-row-reverse" : "")}
      >
        <KeyRound className={cn("h-4 w-4", isRTL ? "ml-2" : "mr-2")} />
        <span className="flex-1">{t('userMenu.security')}</span>
      </DropdownMenuItem>
    </DropdownMenuGroup>
  );
}

export function OrganizationItems({ isRTL, navigate }: HeaderUserMenuItemsProps) {
  const { t } = useTranslation()
  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel className={cn("text-xs text-muted-foreground px-2", isRTL ? "text-right" : "")}>
        {t('userMenu.organization')}
      </DropdownMenuLabel>

      <DropdownMenuItem
        onClick={() => navigate('/org-admin/users')}
        className={cn("cursor-pointer", isRTL ? "flex-row-reverse" : "")}
      >
        <Building2 className={cn("h-4 w-4", isRTL ? "ml-2" : "mr-2")} />
        <span className="flex-1">{t('userMenu.manageUsers')}</span>
      </DropdownMenuItem>

      <DropdownMenuItem
        onClick={() => navigate('/org-admin/roles')}
        className={cn("cursor-pointer", isRTL ? "flex-row-reverse" : "")}
      >
        <Shield className={cn("h-4 w-4", isRTL ? "ml-2" : "mr-2")} />
        <span className="flex-1">{t('userMenu.rolesPermissions')}</span>
      </DropdownMenuItem>

      <DropdownMenuItem
        onClick={() => navigate('/settings')}
        className={cn("cursor-pointer", isRTL ? "flex-row-reverse" : "")}
      >
        <Settings className={cn("h-4 w-4", isRTL ? "ml-2" : "mr-2")} />
        <span className="flex-1">{t('userMenu.settings')}</span>
        <DropdownMenuShortcut>⌘S</DropdownMenuShortcut>
      </DropdownMenuItem>
    </DropdownMenuGroup>
  );
}

export function ActivityItems({ isRTL, navigate }: HeaderUserMenuItemsProps) {
  const { t } = useTranslation()
  return (
    <DropdownMenuGroup>
      <DropdownMenuItem
        onClick={() => navigate('/activity-log')}
        className={cn("cursor-pointer", isRTL ? "flex-row-reverse" : "")}
      >
        <History className={cn("h-4 w-4", isRTL ? "ml-2" : "mr-2")} />
        <span className="flex-1">{t('userMenu.activityLog')}</span>
      </DropdownMenuItem>

      <DropdownMenuItem
        onClick={() => navigate('/active-sessions')}
        className={cn("cursor-pointer", isRTL ? "flex-row-reverse" : "")}
      >
        <Smartphone className={cn("h-4 w-4", isRTL ? "ml-2" : "mr-2")} />
        <span className="flex-1">{t('userMenu.activeSessions')}</span>
      </DropdownMenuItem>

      <DropdownMenuItem
        onClick={() => globalThis.window?.open('https://docs.wardah.sa', '_blank')}
        className={cn("cursor-pointer", isRTL ? "flex-row-reverse" : "")}
      >
        <HelpCircle className={cn("h-4 w-4", isRTL ? "ml-2" : "mr-2")} />
        <span className="flex-1">{t('userMenu.helpSupport')}</span>
      </DropdownMenuItem>
    </DropdownMenuGroup>
  );
}

