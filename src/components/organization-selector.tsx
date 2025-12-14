// src/components/organization-selector.tsx
// مكون لاختيار المنظمة في نظام Multi-Tenant

import { useState } from 'react';
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

// مكون عرض شعار المؤسسة
function OrganizationLogo({ 
  logoUrl, 
  name, 
  size = 'sm' 
}: { 
  logoUrl?: string | null; 
  name: string; 
  size?: 'sm' | 'md' | 'lg';
}) {
  const sizeClasses = {
    sm: 'h-5 w-5',
    md: 'h-8 w-8',
    lg: 'h-10 w-10'
  };

  if (logoUrl) {
    return (
      <img 
        src={logoUrl} 
        alt={name}
        className={cn(
          sizeClasses[size],
          "rounded object-contain"
        )}
        onError={(e) => {
          // إذا فشل تحميل الصورة، أخفِها وسيظهر الـ fallback
          (e.target as HTMLImageElement).style.display = 'none';
        }}
      />
    );
  }

  // Fallback: أيقونة المبنى
  return <Building2 className={cn(sizeClasses[size], "text-muted-foreground")} />;
}

export function OrganizationSelector() {
  const { organizations, currentOrgId, setCurrentOrgId } = useAuth();
  const [open, setOpen] = useState(false);

  const currentOrg = organizations.find(
    (uo: any) => uo.org_id === currentOrgId
  );

  if (organizations.length === 0) {
    return null;
  }

  // If only one organization, show it without dropdown
  if (organizations.length === 1) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-muted rounded-md">
        <OrganizationLogo 
          logoUrl={currentOrg?.organization?.logo_url}
          name={currentOrg?.organization?.name || 'منظمة'}
          size="sm"
        />
        <span className="text-sm font-medium">
          {currentOrg?.organization?.name_ar || currentOrg?.organization?.name || 'منظمة'}
        </span>
      </div>
    );
  }

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
              name={currentOrg?.organization?.name || 'اختر منظمة'}
              size="sm"
            />
            <span className="truncate">
              {currentOrg?.organization?.name_ar || currentOrg?.organization?.name || 'اختر منظمة'}
            </span>
          </div>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[250px] p-0" align="end">
        <Command>
          <CommandInput placeholder="ابحث عن منظمة..." className="h-9" />
          <CommandEmpty>لا توجد منظمات</CommandEmpty>
          <CommandGroup>
            {organizations.map((userOrg: any) => (
              <CommandItem
                key={userOrg.org_id}
                value={userOrg.organization?.name || userOrg.org_id}
                onSelect={() => {
                  setCurrentOrgId(userOrg.org_id);
                  setOpen(false);
                  // Reload the page to apply new org context
                  globalThis.window.location.reload();
                }}
                className="cursor-pointer"
              >
                <div className="flex items-center gap-2 flex-1">
                  <OrganizationLogo 
                    logoUrl={userOrg.organization?.logo_url}
                    name={userOrg.organization?.name || 'منظمة'}
                    size="sm"
                  />
                  <div className="flex flex-col flex-1 gap-0.5">
                    <span className="font-medium">
                      {userOrg.organization?.name_ar || userOrg.organization?.name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {userOrg.organization?.code} • {userOrg.role}
                    </span>
                  </div>
                </div>
                <Check
                  className={cn(
                    'ml-2 h-4 w-4',
                    currentOrgId === userOrg.org_id ? 'opacity-100' : 'opacity-0'
                  )}
                />
              </CommandItem>
            ))}
          </CommandGroup>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
