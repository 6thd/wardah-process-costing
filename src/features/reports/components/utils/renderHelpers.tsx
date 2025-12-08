import { Card, CardContent } from '@/components/ui/card';

export function renderLoadingState(isRTL: boolean) {
  return (
    <Card>
      <CardContent className="py-8 text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
        <p className="mt-4 text-muted-foreground">{isRTL ? 'جاري التحميل...' : 'Loading...'}</p>
      </CardContent>
    </Card>
  );
}

export function renderEmptyState(isRTL: boolean) {
  return (
    <Card>
      <CardContent className="py-8 text-center text-muted-foreground">
        {isRTL ? 'لا توجد بيانات' : 'No data available'}
      </CardContent>
    </Card>
  );
}

