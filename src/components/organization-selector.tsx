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
        <Building2 className="h-4 w-4 text-muted-foreground" />
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
            <Building2 className="h-4 w-4 text-muted-foreground" />
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
                  window.location.reload();
                }}
                className="cursor-pointer"
              >
                <div className="flex flex-col flex-1 gap-1">
                  <span className="font-medium">
                    {userOrg.organization?.name_ar || userOrg.organization?.name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {userOrg.organization?.code} • {userOrg.role}
                  </span>
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

