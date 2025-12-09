import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

interface HeaderBrandProps {
  readonly isRTL: boolean;
}

export function HeaderBrand({ isRTL }: HeaderBrandProps) {
  const { t } = useTranslation();

  return (
    <div className={cn(
      "hidden lg:flex items-center gap-2",
      isRTL ? "flex-row-reverse" : "flex-row"
    )}>
      <h1 className={cn(
        "text-xl font-bold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent",
        isRTL ? "text-right" : "text-left"
      )}>
        {t('app.name')}
      </h1>
      <Badge variant="secondary" className="text-xs">
        {t('app.version')}
      </Badge>
    </div>
  );
}

