import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

interface HeaderSearchProps {
  readonly isRTL: boolean;
}

export function HeaderSearch({ isRTL }: HeaderSearchProps) {
  const { t } = useTranslation();

  return (
    <div className="hidden md:flex flex-1 max-w-md mx-4">
      <div className="relative w-full">
        <Search className={cn(
          "absolute top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground",
          isRTL ? "right-3" : "left-3"
        )} />
        <Input
          placeholder={t('common.search')}
          className={cn(
            "bg-muted/50",
            isRTL ? "pr-10 text-right" : "pl-10 text-left"
          )}
          dir={isRTL ? 'rtl' : 'ltr'}
        />
      </div>
    </div>
  );
}

