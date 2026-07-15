import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell,
} from '@/components/ui/table';
import { ReportSkeleton } from '@/components/ui/loading-state';
import { ErrorState } from '@/components/ui/error-state';
import {
  fetchFinancialStatements,
  type AccountBalanceRow,
} from '@/services/financial-statements-service';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

function AccountsTable({ title, rows, total }: {
  readonly title: string;
  readonly rows: AccountBalanceRow[];
  readonly total: number;
}) {
  return (
    <Card className="wardah-glass-card">
      <CardHeader>
        <CardTitle className="text-right text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground text-right">
            لا توجد أرصدة — تظهر القيم عند ترحيل قيود مطابقة لشجرة الحسابات.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">الكود</TableHead>
                  <TableHead className="text-right">الحساب</TableHead>
                  <TableHead className="text-start">الرصيد</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.code}>
                    <TableCell className="text-right font-mono text-xs">{r.code}</TableCell>
                    <TableCell className="text-right">{r.name}</TableCell>
                    <TableCell className="text-start">{fmt(r.balance)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="text-right font-bold" colSpan={2}>الإجمالي</TableCell>
                  <TableCell className="text-start font-bold">{fmt(total)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** القوائم المالية المصغّرة: قائمة دخل + ملخص ميزانية من أرصدة GL الفعلية. */
export function FinancialStatementsReport() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['financial-statements'],
    queryFn: fetchFinancialStatements,
  });

  if (isLoading) return <ReportSkeleton />;
  if (isError || !data) {
    return (
      <ErrorState
        title="تعذّر تحميل القوائم المالية"
        message={error instanceof Error ? error.message : String(error ?? 'لا توجد بيانات')}
        onRetry={() => refetch()}
      />
    );
  }

  const { incomeStatement: inc, balanceSheet: bs } = data;

  return (
    <div className="space-y-6">
      {/* ملخص قائمة الدخل */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="wardah-glass-card">
          <CardContent className="p-6 text-right">
            <p className="text-sm text-muted-foreground">الإيرادات</p>
            <p className="text-2xl font-bold">{fmt(inc.revenue)}</p>
          </CardContent>
        </Card>
        <Card className="wardah-glass-card">
          <CardContent className="p-6 text-right">
            <p className="text-sm text-muted-foreground">المصروفات</p>
            <p className="text-2xl font-bold">{fmt(inc.expenses)}</p>
          </CardContent>
        </Card>
        <Card className="wardah-glass-card">
          <CardContent className="p-6 text-right">
            <p className="text-sm text-muted-foreground">صافي الدخل</p>
            <p className={`text-2xl font-bold ${inc.netIncome >= 0 ? 'text-success' : 'text-destructive'}`}>
              {fmt(inc.netIncome)}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <AccountsTable title="حسابات الإيرادات" rows={inc.revenueAccounts} total={inc.revenue} />
        <AccountsTable title="حسابات المصروفات" rows={inc.expenseAccounts} total={inc.expenses} />
      </div>

      {/* ملخص الميزانية */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="wardah-glass-card">
          <CardContent className="p-6 text-right">
            <p className="text-sm text-muted-foreground">الأصول</p>
            <p className="text-2xl font-bold">{fmt(bs.assets)}</p>
          </CardContent>
        </Card>
        <Card className="wardah-glass-card">
          <CardContent className="p-6 text-right">
            <p className="text-sm text-muted-foreground">الخصوم</p>
            <p className="text-2xl font-bold">{fmt(bs.liabilities)}</p>
          </CardContent>
        </Card>
        <Card className="wardah-glass-card">
          <CardContent className="p-6 text-right">
            <p className="text-sm text-muted-foreground">حقوق الملكية</p>
            <p className="text-2xl font-bold">{fmt(bs.equity)}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <AccountsTable title="الأصول" rows={bs.assetAccounts} total={bs.assets} />
        <AccountsTable title="الخصوم" rows={bs.liabilityAccounts} total={bs.liabilities} />
        <AccountsTable title="حقوق الملكية" rows={bs.equityAccounts} total={bs.equity} />
      </div>

      {data.unmatchedLinesCount > 0 && (
        <p className="text-xs text-muted-foreground text-right">
          ملاحظة شفافية: {data.unmatchedLinesCount} سطر قيود لا يطابق شجرة الحسابات
          الحالية فاستُبعد من القوائم (تلزم مواءمة أكواد الحسابات لاحتسابه).
        </p>
      )}
    </div>
  );
}

export default FinancialStatementsReport;
