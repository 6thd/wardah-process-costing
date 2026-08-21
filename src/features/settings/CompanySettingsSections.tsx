import type { ChangeEventHandler, RefObject } from 'react';
import {
  AlertCircle,
  Building2,
  Camera,
  CheckCircle2,
  Hash,
  Loader2,
  Save,
  Trash2,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Translate = (arabic: string, english: string) => string;

interface CompanySettingsHeaderProps {
  readonly isRTL: boolean;
  readonly canUpdate: boolean;
  readonly hasChanges: boolean;
  readonly isSaving: boolean;
  readonly onSave: () => void;
  readonly tr: Translate;
}

export function CompanySettingsHeader({
  isRTL,
  canUpdate,
  hasChanges,
  isSaving,
  onSave,
  tr,
}: CompanySettingsHeaderProps) {
  return (
    <>
      <div
        className={cn(
          'flex items-start justify-between gap-4',
          isRTL ? 'flex-row-reverse' : '',
        )}
      >
        <div className={cn(isRTL ? 'text-right' : 'text-left')}>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Building2 className="h-8 w-8 text-primary" />
            {tr('بيانات الشركة', 'Company Profile')}
          </h1>
          <p className="text-muted-foreground mt-2">
            {tr(
              'إدارة معلومات الشركة والهوية البصرية والإعدادات العامة',
              'Manage company information, branding and general settings',
            )}
          </p>
        </div>

        {canUpdate && (
          <Button
            onClick={onSave}
            disabled={!hasChanges || isSaving}
            className={cn(
              'min-w-[140px]',
              hasChanges ? 'bg-primary hover:bg-primary/90' : '',
            )}
          >
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin ml-2" />
                {tr('جاري الحفظ...', 'Saving...')}
              </>
            ) : (
              <>
                <Save className="h-4 w-4 ml-2" />
                {tr('حفظ التغييرات', 'Save Changes')}
              </>
            )}
          </Button>
        )}
      </div>

      {hasChanges && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center gap-2 text-amber-800">
          <AlertCircle className="h-5 w-5" />
          <span>{tr('لديك تغييرات غير محفوظة', 'You have unsaved changes')}</span>
        </div>
      )}
    </>
  );
}

interface CompanyLogoPanelProps {
  readonly logoUrl: string;
  readonly organizationCode?: string | null;
  readonly canUpdate: boolean;
  readonly isUploadingLogo: boolean;
  readonly fileInputRef: RefObject<HTMLInputElement | null>;
  readonly onLogoUpload: ChangeEventHandler<HTMLInputElement>;
  readonly onDeleteLogo: () => void;
  readonly tr: Translate;
}

function EmptyLogo({
  canUpdate,
  isUploadingLogo,
  fileInputRef,
  tr,
}: Pick<
  CompanyLogoPanelProps,
  'canUpdate' | 'isUploadingLogo' | 'fileInputRef' | 'tr'
>) {
  const openFilePicker = () => {
    if (canUpdate) fileInputRef.current?.click();
  };

  return (
    <div
      className={cn(
        'text-center p-4',
        canUpdate ? 'cursor-pointer' : 'cursor-not-allowed opacity-60',
      )}
      role="button"
      tabIndex={0}
      onClick={openFilePicker}
      onKeyDown={(event) => {
        if (canUpdate && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          fileInputRef.current?.click();
        }
      }}
    >
      {isUploadingLogo ? (
        <Loader2 className="h-10 w-10 animate-spin mx-auto text-muted-foreground" />
      ) : (
        <>
          <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-2" />
          <span className="text-sm text-muted-foreground">
            {tr('اضغط لرفع الشعار', 'Click to upload logo')}
          </span>
        </>
      )}
    </div>
  );
}

function LogoPreview({
  logoUrl,
  canUpdate,
  isUploadingLogo,
  fileInputRef,
  onDeleteLogo,
  tr,
}: Pick<
  CompanyLogoPanelProps,
  | 'logoUrl'
  | 'canUpdate'
  | 'isUploadingLogo'
  | 'fileInputRef'
  | 'onDeleteLogo'
  | 'tr'
>) {
  return (
    <>
      <img
        src={logoUrl}
        alt={tr('شعار الشركة', 'Company logo')}
        className="w-full h-full object-contain p-2"
      />
      {canUpdate && (
        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploadingLogo}
          >
            <Upload className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={onDeleteLogo}
            disabled={isUploadingLogo}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      )}
    </>
  );
}

export function CompanyLogoPanel(props: CompanyLogoPanelProps) {
  return (
    <div className="lg:col-span-1">
      <div className="bg-card border rounded-xl p-6 space-y-4 sticky top-4">
        <h3 className="font-semibold text-lg flex items-center gap-2">
          <Camera className="h-5 w-5 text-primary" />
          {props.tr('شعار الشركة', 'Company Logo')}
        </h3>

        <div className="relative mx-auto w-40 h-40 rounded-xl border-2 border-dashed border-muted-foreground/25 flex items-center justify-center overflow-hidden bg-muted/50 group">
          {props.logoUrl ? <LogoPreview {...props} /> : <EmptyLogo {...props} />}
        </div>

        <input
          ref={props.fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={props.onLogoUpload}
        />

        <p className="text-xs text-muted-foreground text-center">
          {props.tr('JPG, PNG أو WebP', 'JPG, PNG or WebP')}
          <br />
          {props.tr('الحد الأقصى 5 ميجابايت', 'Maximum size: 5 MB')}
        </p>

        <div className="pt-4 border-t space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <Hash className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">{props.tr('كود:', 'Code:')}</span>
            <span className="font-mono">{props.organizationCode || '-'}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            <span className="text-muted-foreground">{props.tr('الحالة:', 'Status:')}</span>
            <span className="text-green-600">{props.tr('نشط', 'Active')}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function CompanySettingsLoading({ tr }: { readonly tr: Translate }) {
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="text-center space-y-4">
        <Loader2 className="h-10 w-10 animate-spin mx-auto text-primary" />
        <p className="text-muted-foreground">
          {tr('جاري تحميل بيانات الشركة...', 'Loading company data...')}
        </p>
      </div>
    </div>
  );
}
