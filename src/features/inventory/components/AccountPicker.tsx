import { useState, useEffect } from 'react';
import { Check, ChevronsUpDown, Search } from 'lucide-react';
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
import { cn } from '@/lib/utils';
import { warehouseService, type GLAccount } from '@/services/warehouse-service';

interface AccountPickerProps {
  value?: string;
  onValueChange: (accountId: string) => void;
  category?: 'ASSET' | 'EXPENSE' | 'REVENUE' | 'LIABILITY' | 'EQUITY';
  placeholder?: string;
  label?: string;
  disabled?: boolean;
  showSuggested?: boolean;
}

export default function AccountPicker({
  value,
  onValueChange,
  category,
  placeholder = 'اختر حساب...',
  label,
  disabled = false,
  showSuggested = false,
}: AccountPickerProps) {
  const [open, setOpen] = useState(false);
  const [accounts, setAccounts] = useState<GLAccount[]>([]);
  const [suggestedAccounts, setSuggestedAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<GLAccount | null>(null);

  useEffect(() => {
    loadAccounts();
  }, [category]);

  useEffect(() => {
    if (value && accounts.length > 0) {
      const account = accounts.find((a) => a.id === value);
      setSelectedAccount(account || null);
    }
  }, [value, accounts]);

  const loadAccounts = async () => {
    try {
      setLoading(true);
      
      if (showSuggested) {
        const suggested = await warehouseService.getSuggestedAccounts();
        setSuggestedAccounts(suggested || []);
      }

      if (category) {
        const fetchedAccounts = await warehouseService.getGLAccountsByCategory(category);
        setAccounts(fetchedAccounts || []);
      } else {
        // Load all accounts if no category specified
        const allCategories: Array<'ASSET' | 'EXPENSE' | 'REVENUE' | 'LIABILITY' | 'EQUITY'> = [
          'ASSET',
          'EXPENSE',
          'REVENUE',
          'LIABILITY',
          'EQUITY',
        ];
        
        const allAccounts = await Promise.all(
          allCategories.map((cat) => warehouseService.getGLAccountsByCategory(cat))
        );
        
        setAccounts(allAccounts.flat().filter((a): a is GLAccount => a !== null));
      }
    } catch (error) {
      console.error('Error loading accounts:', error);
    } finally {
      setLoading(false);
    }
  };

  const getCategoryLabel = (category: string) => {
    const labels: Record<string, string> = {
      ASSET: 'أصول',
      LIABILITY: 'التزامات',
      EQUITY: 'حقوق ملكية',
      REVENUE: 'إيرادات',
      EXPENSE: 'مصروفات',
    };
    return labels[category] || category;
  };

  // Group accounts by category
  const accountsByCategory = accounts.reduce<Record<string, GLAccount[]>>((acc, account) => {
    const cat = account.category || 'OTHER';
    if (!acc[cat]) {
      acc[cat] = [];
    }
    acc[cat].push(account);
    return acc;
  }, {});

  return (
    <div className="space-y-2">
      {label && (
        <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
          {label}
        </label>
      )}
      
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between"
            disabled={disabled}
          >
            {selectedAccount ? (
              <span className="flex items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">
                  {selectedAccount.code}
                </span>
                <span>{selectedAccount.name}</span>
              </span>
            ) : (
              <span className="text-muted-foreground">{placeholder}</span>
            )}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[400px] p-0" align="start">
          <Command>
            <CommandInput placeholder="ابحث عن حساب..." />
            <CommandEmpty>
              {loading ? 'جاري التحميل...' : 'لا توجد حسابات'}
            </CommandEmpty>
            
            {showSuggested && suggestedAccounts.length > 0 && (
              <CommandGroup heading="الحسابات المقترحة">
                {suggestedAccounts.map((suggested) => (
                  <CommandItem
                    key={suggested.account_id}
                    value={`${suggested.account_code} ${suggested.account_name}`}
                    onSelect={() => {
                      onValueChange(suggested.account_id);
                      setOpen(false);
                    }}
                    className="flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2">
                      <Check
                        className={cn(
                          'h-4 w-4',
                          value === suggested.account_id ? 'opacity-100' : 'opacity-0'
                        )}
                      />
                      <span className="font-mono text-xs text-muted-foreground">
                        {suggested.account_code}
                      </span>
                      <span>{suggested.account_name}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {suggested.purpose}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {Object.entries(accountsByCategory).map(([cat, catAccounts]) => (
              <CommandGroup key={cat} heading={getCategoryLabel(cat)}>
                {catAccounts.map((account) => (
                  <CommandItem
                    key={account.id}
                    value={`${account.code} ${account.name}`}
                    onSelect={() => {
                      onValueChange(account.id);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        'mr-2 h-4 w-4',
                        value === account.id ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                    <span className="font-mono text-xs text-muted-foreground mr-2">
                      {account.code}
                    </span>
                    <span>{account.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
