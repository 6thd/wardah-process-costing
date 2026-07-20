import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Briefcase,
  Calculator,
  CheckCircle2,
  Clock,
  FileText,
  Plus,
  Search,
} from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { checkIsPayrollAdmin } from '@/services/hr/payroll-admin-service';
import { getEmployees } from '@/services/hr/hr-service';
import {
  cancelSettlement,
  createSettlement,
  listSettlements,
  postSettlement,
  submitSettlementForReview,
  type EosResult,
  type SettlementRow,
  type TerminationType,
} from '@/services/hr/settlement-service';

import { getHrStatusKey, useHrTranslation } from '../i18n';
import { STATUS_BADGES } from '../types';
import '../translations/pages';

const TERMINATION_TYPES: TerminationType[] = [
  'resignation',
  'end_of_contract',
  'termination_without_cause',
  'termination_for_cause',
  'mutual_agreement',
  'retirement',
  'death',
];

const EMPTY_FORM = {
  employee_id: '',
  termination_type: '' as TerminationType | '',
  service_end: '',
  notes: '',
};

export const SettlementsPage: React.FC = () => {
  const { t, i18n } = useHrTranslation();
  const locale = i18n.resolvedLanguage?.startsWith('ar') ? 'ar-SA' : 'en-US';
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = React.useState('draft');
  const [searchQuery, setSearchQuery] = React.useState('');
  const [showNewDialog, setShowNewDialog] = React.useState(false);
  const [showDetailsDialog, setShowDetailsDialog] = React.useState(false);
  const [selectedSettlement, setSelectedSettlement] = React.useState<SettlementRow | null>(null);
  const [previewResult, setPreviewResult] = React.useState<EosResult | null>(null);
  const [form, setForm] = React.useState(EMPTY_FORM);

  const { data: settlements = [], isLoading } = useQuery({
    queryKey: ['hr', 'settlements'],
    queryFn: () => listSettlements(200),
  });
  const { data: employees = [] } = useQuery({
    queryKey: ['hr', 'employees'],
    queryFn: getEmployees,
  });
  const { data: isPayrollAdmin = false } = useQuery({
    queryKey: ['hr', 'payroll-admin-gate'],
    queryFn: checkIsPayrollAdmin,
  });

  const filteredSettlements = React.useMemo(
    () => settlements.filter((settlement) => {
      const employee = Array.isArray(settlement.employee)
        ? settlement.employee[0]
        : settlement.employee;
      const matchesTab = activeTab === 'all' || settlement.status === activeTab;
      const matchesSearch = !searchQuery
        || (employee?.full_name ?? '').toLowerCase().includes(searchQuery.toLowerCase());
      return matchesTab && matchesSearch;
    }),
    [activeTab, searchQuery, settlements],
  );

  const stats = React.useMemo(() => ({
    draft: settlements.filter((item) => item.status === 'draft').length,
    review: settlements.filter((item) => item.status === 'review').length,
    approved: settlements.filter((item) => item.status === 'approved').length,
    paid: settlements.filter((item) => item.status === 'paid').length,
    totalAmount: settlements.reduce((sum, item) => sum + (item.payable_amount ?? 0), 0),
  }), [settlements]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['hr', 'settlements'] });
  const operationError = (error: Error) => toast.error(error.message || t('settlements.operationFailed'));

  const createMutation = useMutation({
    mutationFn: () => createSettlement({
      employee_id: form.employee_id,
      termination_type: form.termination_type as TerminationType,
      service_end: form.service_end,
      notes: form.notes || undefined,
    }),
    onSuccess: ({ settlement, result }) => {
      setSelectedSettlement(settlement);
      setPreviewResult(result);
      setShowNewDialog(false);
      setShowDetailsDialog(true);
      setForm(EMPTY_FORM);
      refresh();
      toast.success(t('settlements.createdSuccess'));
    },
    onError: operationError,
  });

  const reviewMutation = useMutation({
    mutationFn: submitSettlementForReview,
    onSuccess: () => {
      refresh();
      setShowDetailsDialog(false);
      toast.success(t('settlements.reviewSuccess'));
    },
    onError: operationError,
  });

  const postMutation = useMutation({
    mutationFn: postSettlement,
    onSuccess: () => {
      refresh();
      setShowDetailsDialog(false);
      toast.success(t('settlements.postedSuccess'));
    },
    onError: operationError,
  });

  const cancelMutation = useMutation({
    mutationFn: cancelSettlement,
    onSuccess: () => {
      refresh();
      setShowDetailsDialog(false);
      toast.success(t('settlements.cancelledSuccess'));
    },
    onError: operationError,
  });

  const pending = createMutation.isPending
    || reviewMutation.isPending
    || postMutation.isPending
    || cancelMutation.isPending;

  const formatNumber = (value: number, digits = 0) => new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
  const formatCurrency = (value?: number | null) => new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'SAR',
  }).format(value ?? 0);
  const formatDate = (value?: string | null) => value
    ? new Intl.DateTimeFormat(locale).format(new Date(value))
    : '—';
  const terminationLabel = (type?: string | null) => t(
    `settlements.termination.${type || 'resignation'}`,
  );

  const openDetails = (settlement: SettlementRow) => {
    setSelectedSettlement(settlement);
    setPreviewResult(null);
    setShowDetailsDialog(true);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t('settlements.title')}</h1>
        <p className="text-muted-foreground">{t('settlements.subtitle')}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-5">
        {([
          ['draft', stats.draft],
          ['review', stats.review],
          ['approved', stats.approved],
          ['paid', stats.paid],
        ] as const).map(([key, value]) => (
          <Card key={key}>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">{t(`settlements.${key}`)}</p>
              <p className="text-2xl font-bold">{formatNumber(value)}</p>
            </CardContent>
          </Card>
        ))}
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">{t('settlements.totalAmount')}</p>
            <p className="text-xl font-bold">{formatCurrency(stats.totalAmount)}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>{t('settlements.listTitle')}</CardTitle>
            <CardDescription>{t('settlements.listDescription')}</CardDescription>
          </div>
          <Button onClick={() => setShowNewDialog(true)}>
            <Plus className="me-2 h-4 w-4" />
            {t('settlements.newSettlement')}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative max-w-sm">
            <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="ps-10"
              placeholder={t('settlements.searchPlaceholder')}
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="draft">{t('settlements.draft')} ({formatNumber(stats.draft)})</TabsTrigger>
              <TabsTrigger value="review">{t('settlements.review')} ({formatNumber(stats.review)})</TabsTrigger>
              <TabsTrigger value="approved">{t('settlements.approved')}</TabsTrigger>
              <TabsTrigger value="paid">{t('settlements.paid')}</TabsTrigger>
              <TabsTrigger value="all">{t('common.all')}</TabsTrigger>
            </TabsList>
            <TabsContent value={activeTab} className="mt-4">
              {isLoading ? (
                <div className="py-8 text-center">{t('common.loading')}</div>
              ) : filteredSettlements.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">
                  <Briefcase className="mx-auto mb-3 h-12 w-12" />
                  {t('settlements.noSettlements')}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('common.employee')}</TableHead>
                      <TableHead>{t('settlements.terminationReason')}</TableHead>
                      <TableHead>{t('settlements.terminationDate')}</TableHead>
                      <TableHead>{t('settlements.serviceYears')}</TableHead>
                      <TableHead>{t('settlements.payable')}</TableHead>
                      <TableHead>{t('common.status')}</TableHead>
                      <TableHead>{t('common.actions')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredSettlements.map((settlement) => {
                      const employee = Array.isArray(settlement.employee)
                        ? settlement.employee[0]
                        : settlement.employee;
                      const years = settlement.service_days
                        ? settlement.service_days / 365.25
                        : null;

                      return (
                        <TableRow key={settlement.id}>
                          <TableCell>{employee?.full_name ?? '—'}</TableCell>
                          <TableCell>
                            {terminationLabel(settlement.termination_type ?? settlement.settlement_type)}
                          </TableCell>
                          <TableCell>{formatDate(settlement.service_end)}</TableCell>
                          <TableCell>
                            <Badge variant="outline">
                              {years === null
                                ? '—'
                                : t('settlements.years', {
                                    count: years,
                                    formattedCount: formatNumber(years, 1),
                                  })}
                            </Badge>
                          </TableCell>
                          <TableCell>{formatCurrency(settlement.payable_amount)}</TableCell>
                          <TableCell>
                            <Badge className={STATUS_BADGES[settlement.status] || 'bg-slate-100 text-slate-700'}>
                              {t(getHrStatusKey(settlement.status))}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openDetails(settlement)}
                              aria-label={t('common.view')}
                            >
                              <FileText className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('settlements.newTitle')}</DialogTitle>
            <DialogDescription>{t('settlements.newDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t('common.employee')} *</Label>
              <Select
                value={form.employee_id}
                onValueChange={(value) => setForm((current) => ({ ...current, employee_id: value }))}
              >
                <SelectTrigger><SelectValue placeholder={t('settlements.selectEmployee')} /></SelectTrigger>
                <SelectContent>
                  {employees.map((employee) => (
                    <SelectItem key={employee.id} value={employee.id}>{employee.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t('settlements.terminationReason')} *</Label>
              <Select
                value={form.termination_type}
                onValueChange={(value) => setForm((current) => ({
                  ...current,
                  termination_type: value as TerminationType,
                }))}
              >
                <SelectTrigger><SelectValue placeholder={t('settlements.selectReason')} /></SelectTrigger>
                <SelectContent>
                  {TERMINATION_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>{terminationLabel(type)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.termination_type === 'termination_for_cause' && (
                <p className="mt-2 flex items-center gap-2 text-sm text-rose-500">
                  <AlertTriangle className="h-4 w-4" />
                  {t('settlements.article80Warning')}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>{t('settlements.endDate')}</Label>
              <Input
                type="date"
                value={form.service_end}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  service_end: event.target.value,
                }))}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('common.notes')}</Label>
              <Input
                placeholder={t('settlements.notesPlaceholder')}
                value={form.notes}
                onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewDialog(false)}>{t('common.cancel')}</Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!form.employee_id || !form.termination_type || !form.service_end || pending}
            >
              <Calculator className="me-2 h-4 w-4" />
              {pending ? t('settlements.calculating') : t('settlements.calculateCreate')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDetailsDialog} onOpenChange={setShowDetailsDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('settlements.detailsTitle')}</DialogTitle>
            <DialogDescription>{t('settlements.detailsDescription')}</DialogDescription>
          </DialogHeader>
          {selectedSettlement && (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <CardContent className="space-y-2 p-4">
                    <h4 className="font-semibold">{t('settlements.serviceData')}</h4>
                    <div className="flex justify-between">
                      <span>{t('settlements.terminationReason')}</span>
                      <span>{terminationLabel(selectedSettlement.termination_type ?? selectedSettlement.settlement_type)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>{t('settlements.serviceStart')}</span>
                      <span>{formatDate(selectedSettlement.service_start)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>{t('settlements.serviceEnd')}</span>
                      <span>{formatDate(selectedSettlement.service_end)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>{t('settlements.serviceYears')}</span>
                      <span>{selectedSettlement.service_days
                        ? formatNumber(selectedSettlement.service_days / 365.25, 2)
                        : '—'}</span>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="space-y-2 p-4">
                    <h4 className="font-semibold">{t('settlements.entitlements')}</h4>
                    {previewResult ? (
                      <>
                        <div className="flex justify-between"><span>{t('settlements.eos')}</span><span>{formatCurrency(previewResult.eos_amount)}</span></div>
                        <div className="flex justify-between"><span>{t('settlements.leaveEncashment')}</span><span>{formatCurrency(previewResult.leave_encashment)}</span></div>
                        <div className="flex justify-between"><span>{t('settlements.art77')}</span><span>{formatCurrency(previewResult.art77_compensation)}</span></div>
                      </>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </CardContent>
                </Card>
              </div>
              <div className="flex justify-between rounded-lg border bg-teal-500/10 p-4">
                <b>{t('settlements.totalSettlement')}</b>
                <b>{formatCurrency(selectedSettlement.payable_amount)}</b>
              </div>
              {selectedSettlement.status === 'draft' && (
                <div className="rounded-lg border bg-sky-500/10 p-3 text-sm">{t('settlements.draftNext')}</div>
              )}
              {selectedSettlement.status === 'review' && (
                <div className="rounded-lg border bg-amber-500/10 p-3 text-sm">{t('settlements.reviewWarning')}</div>
              )}
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowDetailsDialog(false)}>{t('common.cancel')}</Button>
            {(selectedSettlement?.status === 'draft' || selectedSettlement?.status === 'review') && (
              <Button
                variant="outline"
                onClick={() => cancelMutation.mutate(selectedSettlement.id)}
                disabled={pending}
              >
                {t('settlements.cancelSettlement')}
              </Button>
            )}
            {selectedSettlement?.status === 'draft' && (
              <Button
                onClick={() => reviewMutation.mutate(selectedSettlement.id)}
                disabled={pending || !isPayrollAdmin}
                title={!isPayrollAdmin ? t('settlements.adminRequiredReview') : undefined}
              >
                <Clock className="me-2 h-4 w-4" />
                {pending ? t('settlements.sending') : t('settlements.sendReview')}
              </Button>
            )}
            {selectedSettlement?.status === 'review' && (
              <Button
                onClick={() => postMutation.mutate(selectedSettlement.id)}
                disabled={pending || !isPayrollAdmin}
                title={!isPayrollAdmin ? t('settlements.adminRequiredPost') : undefined}
              >
                <CheckCircle2 className="me-2 h-4 w-4" />
                {pending ? t('settlements.posting') : t('settlements.post')}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
