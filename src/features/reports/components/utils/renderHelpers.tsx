import i18next from 'i18next';
import { Card, CardContent } from '@/components/ui/card';

const t = (key: string) => i18next.t(key);

export function renderLoadingState() {
  return (
    <Card>
      <CardContent className="py-8 text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
        <p className="mt-4 text-muted-foreground">{t('salesReports.loading')}</p>
      </CardContent>
    </Card>
  );
}

export function renderEmptyState() {
  return (
    <Card>
      <CardContent className="py-8 text-center text-muted-foreground">
        {t('salesReports.noData')}
      </CardContent>
    </Card>
  );
}

