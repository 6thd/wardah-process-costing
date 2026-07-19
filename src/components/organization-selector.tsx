import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Building2, Check, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';

interface OrganizationMembership {
  org_id: string;
  role?: string | null;
  organization?: {
    name?: string | null;
    name_ar?: string | null;
    name_en?: string | null;
    code?: string | null;
    logo_url?: string | null;
  } | null;
}

function OrganizationLogo({
  logoUrl,
  name,
  size = 'sm',
}: Readonly<{
  logoUrl?: string | null;
  name: string;
  size?: 'sm' | 'md' | 'lg';
}>) {
  const sizeClasses = {
    sm: 'h-5 w-5',
    md: 'h-8 w-8',
    lg: 'h-10 w-10',
  };

  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={name}
        className={cn(sizeClasses[size], 'rounded object-contain')}
        onError={(event) => {
          (event.currentTarget as HTMLImageElement).style.display = 'none';
        }}
      />
    );
  }

  return <Building2 className={cn(sizeClasses[size], 'text-muted-foreground')} />;
}

function isArabicLocale(language?: string): boolean {
  return (language ?? '').toLowerCase().startsWith('ar');
}

export function OrganizationSelector() {
  const { i18n } = useTranslation();
  const isArabic = isArabicLocale(i18n.resolvedLanguage ?? i18n.language);
  const translate = (ar: string, en: string) => (isArabic ? ar : en);
  const { organizations, currentOrgId, setCurrentOrgId } = useAuth();
  const [open, setOpen] = useState(false);

  const memberships = organizations as OrganizationMembership[];
  const currentOrg = memberships.find((membership) => membership.org_id === currentOrgId);

  const getOrganizationName = (membership?: OrganizationMembership): string => {
    const organization = membership?.organization;
    if (!organization) return '';

    return isArabic
      ? organization.name_ar || organization.name || organization.name_en || ''
      : organization.name_en || organization.name || organization.name_ar || '';
  };

  if (memberships.length === 0) return null;

  if (memberships.length === 1) {
    const currentName = getOrganizationName(currentOrg) || translate('مؤسسة', 'Organization');
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-muted rounded-md">
        <OrganizationLogo
          logoUrl={currentOrg?.organization?.logo_url}
          name={currentName}
          size="sm"
        />
        <span className="text-sm font-medium">{currentName}</span>
      </div>
    );
  }

  const currentName = getOrganizationName(currentOrg) || translate('اختر مؤسسة', 'Select organization');

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-[250px] justify-between"
        >
          <div className="flex items-center gap-2">
            <OrganizationLogo
              logoUrl={currentOrg?.organization?.logo_url}
              name={currentName}
              size="sm"
            />
            <span className="truncate">{currentName}</span>
          </div>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[250px] p-0" align="end">
        <Command>
          <CommandInput
            placeholder={translate('ابحث عن مؤسسة...', 'Search organizations...')}
            className="h-9"
          />
          <CommandEmpty>
            {translate('لا توجد مؤسسات', 'No organizations found')}
          </CommandEmpty>
          <CommandGroup>
            {memberships.map((membership) => {
              const organizationName = getOrganizationName(membership)
                || translate('مؤسسة', 'Organization');

              return (
                <CommandItem
                  key={membership.org_id}
                  value={organizationName || membership.org_id}
                  onSelect={() => {
                    setCurrentOrgId(membership.org_id);
                    setOpen(false);
                    globalThis.window.location.reload();
                  }}
                  className="cursor-pointer"
                >
                  <div className="flex items-center gap-2 flex-1">
                    <OrganizationLogo
                      logoUrl={membership.organization?.logo_url}
                      name={organizationName}
                      size="sm"
                    />
                    <div className="flex flex-col flex-1 gap-0.5">
                      <span className="font-medium">{organizationName}</span>
                      <span className="text-xs text-muted-foreground">
                        {membership.organization?.code} • {membership.role}
                      </span>
                    </div>
                  </div>
                  <Check
                    className={cn(
                      'ml-2 h-4 w-4',
                      currentOrgId === membership.org_id ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                </CommandItem>
              );
            })}
          </CommandGroup>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
