/**
 * Company Settings / Profile Component
 * مكون إعدادات وملف الشركة
 * Multi-tenant Support
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { 
  Building2, 
  Phone, 
  Mail, 
  Globe, 
  MapPin, 
  FileText,
  Upload,
  Trash2,
  Save,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Camera,
  Palette,
  Settings2,
  Building,
  Hash,
  Calendar
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue 
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import {
  OrganizationProfile,
  UpdateOrganizationInput,
  getOrganizationProfile,
  updateOrganizationProfile,
  uploadOrganizationLogo,
  deleteOrganizationLogo
} from '@/lib/organization';

// ===================================
// Types
// ===================================

interface FormState {
  // المعلومات الأساسية
  name: string;
  name_ar: string;
  name_en: string;
  // البيانات الضريبية
  tax_number: string;
  commercial_registration: string;
  license_number: string;
  // التواصل
  phone: string;
  mobile: string;
  email: string;
  website: string;
  fax: string;
  // العنوان
  address: string;
  city: string;
  state: string;
  country: string;
  postal_code: string;
  // الهوية البصرية
  logo_url: string;
  primary_color: string;
  secondary_color: string;
  // الإعدادات
  currency: string;
  timezone: string;
  fiscal_year_start: number;
  date_format: string;
}

const initialFormState: FormState = {
  name: '',
  name_ar: '',
  name_en: '',
  tax_number: '',
  commercial_registration: '',
  license_number: '',
  phone: '',
  mobile: '',
  email: '',
  website: '',
  fax: '',
  address: '',
  city: '',
  state: '',
  country: 'المملكة العربية السعودية',
  postal_code: '',
  logo_url: '',
  primary_color: '#1e40af',
  secondary_color: '#3b82f6',
  currency: 'SAR',
  timezone: 'Asia/Riyadh',
  fiscal_year_start: 1,
  date_format: 'DD/MM/YYYY'
};

/**
 * Maps organization profile data to form state with defaults
 * Extracted to reduce complexity in loadOrganizationData
 */
function mapOrganizationToFormState(data: OrganizationProfile): FormState {
  return {
    name: data.name || '',
    name_ar: data.name_ar || '',
    name_en: data.name_en || '',
    tax_number: data.tax_number || '',
    commercial_registration: data.commercial_registration || '',
    license_number: data.license_number || '',
    phone: data.phone || '',
    mobile: data.mobile || '',
    email: data.email || '',
    website: data.website || '',
    fax: data.fax || '',
    address: data.address || '',
    city: data.city || '',
    state: data.state || '',
    country: data.country || initialFormState.country,
    postal_code: data.postal_code || '',
    logo_url: data.logo_url || '',
    primary_color: data.primary_color || initialFormState.primary_color,
    secondary_color: data.secondary_color || initialFormState.secondary_color,
    currency: data.currency || initialFormState.currency,
    timezone: data.timezone || initialFormState.timezone,
    fiscal_year_start: data.fiscal_year_start || initialFormState.fiscal_year_start,
    date_format: data.date_format || initialFormState.date_format
  };
}

// ===================================
// Constants
// ===================================

const CURRENCIES = [
  ['SAR', 'ريال سعودي (SAR)', 'Saudi Riyal (SAR)'],
  ['AED', 'درهم إماراتي (AED)', 'UAE Dirham (AED)'],
  ['USD', 'دولار أمريكي (USD)', 'US Dollar (USD)'],
  ['EUR', 'يورو (EUR)', 'Euro (EUR)'],
  ['GBP', 'جنيه إسترليني (GBP)', 'British Pound (GBP)'],
  ['EGP', 'جنيه مصري (EGP)', 'Egyptian Pound (EGP)'],
  ['KWD', 'دينار كويتي (KWD)', 'Kuwaiti Dinar (KWD)'],
  ['BHD', 'دينار بحريني (BHD)', 'Bahraini Dinar (BHD)'],
  ['QAR', 'ريال قطري (QAR)', 'Qatari Riyal (QAR)'],
  ['OMR', 'ريال عماني (OMR)', 'Omani Rial (OMR)'],
] as const;

const TIMEZONES = [
  ['Asia/Riyadh', 'الرياض (GMT+3)', 'Riyadh (GMT+3)'],
  ['Asia/Dubai', 'دبي (GMT+4)', 'Dubai (GMT+4)'],
  ['Asia/Kuwait', 'الكويت (GMT+3)', 'Kuwait (GMT+3)'],
  ['Africa/Cairo', 'القاهرة (GMT+2)', 'Cairo (GMT+2)'],
  ['Europe/London', 'لندن (GMT+0)', 'London (GMT+0)'],
  ['America/New_York', 'نيويورك (GMT-5)', 'New York (GMT-5)'],
] as const;

const DATE_FORMATS = [
  { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY' },
  { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY' },
  { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD' },
  { value: 'DD-MM-YYYY', label: 'DD-MM-YYYY' },
];

const FISCAL_MONTHS = [
  [1, 'يناير', 'January'], [2, 'فبراير', 'February'], [3, 'مارس', 'March'],
  [4, 'أبريل', 'April'], [5, 'مايو', 'May'], [6, 'يونيو', 'June'],
  [7, 'يوليو', 'July'], [8, 'أغسطس', 'August'], [9, 'سبتمبر', 'September'],
  [10, 'أكتوبر', 'October'], [11, 'نوفمبر', 'November'], [12, 'ديسمبر', 'December'],
] as const;

// ===================================
// Component
// ===================================

export function CompanySettings() {
  const { i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? i18n.language;
  const isRTL = language.toLowerCase().startsWith('ar');
  const tr = (arabic: string, english: string) => (isRTL ? arabic : english);
  
  // State
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [form, setForm] = useState<FormState>(initialFormState);
  const [originalData, setOriginalData] = useState<OrganizationProfile | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [activeTab, setActiveTab] = useState('basic');
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load organization data
  useEffect(() => {
    loadOrganizationData();
  }, []);

  // Check for changes
  useEffect(() => {
    if (originalData) {
      const changed = Object.keys(form).some(key => {
        const formValue = form[key as keyof FormState];
        const originalValue = originalData[key as keyof OrganizationProfile];
        return formValue !== (originalValue || '');
      });
      setHasChanges(changed);
    }
  }, [form, originalData]);

  const loadOrganizationData = async () => {
    setIsLoading(true);
    try {
      const result = await getOrganizationProfile();
      
      if (result.success && result.data) {
        setOriginalData(result.data);
        setForm(mapOrganizationToFormState(result.data));
      } else {
        toast.error(result.error || tr('فشل تحميل بيانات الشركة', 'Failed to load company data'));
      }
    } catch (error) {
      console.error('Error loading organization:', error);
      toast.error(tr('حدث خطأ أثناء تحميل البيانات', 'An error occurred while loading data'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleInputChange = useCallback((field: keyof FormState, value: string | number) => {
    setForm(prev => ({ ...prev, [field]: value }));
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const updates: UpdateOrganizationInput = {};
      
      // فقط إرسال القيم المتغيرة
      for (const [key, value] of Object.entries(form)) {
        if (originalData) {
          const originalValue = originalData[key as keyof OrganizationProfile];
          if (value !== (originalValue || '')) {
            (updates as Record<string, unknown>)[key] = value;
          }
        }
      }

      const result = await updateOrganizationProfile(updates);
      
      if (result.success) {
        toast.success(tr('تم حفظ البيانات بنجاح', 'Company data saved successfully'));
        setOriginalData(result.data!);
        setHasChanges(false);
      } else {
        toast.error(result.error || tr('فشل حفظ البيانات', 'Failed to save company data'));
      }
    } catch (error) {
      console.error('Error saving:', error);
      toast.error(tr('حدث خطأ أثناء الحفظ', 'An error occurred while saving'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleLogoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploadingLogo(true);
    try {
      const result = await uploadOrganizationLogo(file);
      
      if (result.success && result.url) {
        setForm(prev => ({ ...prev, logo_url: result.url! }));
        toast.success(tr('تم رفع الشعار بنجاح', 'Logo uploaded successfully'));
        // Reload to get updated data
        await loadOrganizationData();
      } else {
        toast.error(result.error || tr('فشل رفع الشعار', 'Failed to upload logo'));
      }
    } catch (error) {
      console.error('Error uploading logo:', error);
      toast.error(tr('حدث خطأ أثناء رفع الشعار', 'An error occurred while uploading the logo'));
    } finally {
      setIsUploadingLogo(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleDeleteLogo = async () => {
    if (!form.logo_url) return;
    
    setIsUploadingLogo(true);
    try {
      const result = await deleteOrganizationLogo();
      
      if (result.success) {
        setForm(prev => ({ ...prev, logo_url: '' }));
        toast.success(tr('تم حذف الشعار بنجاح', 'Logo deleted successfully'));
        await loadOrganizationData();
      } else {
        toast.error(result.error || tr('فشل حذف الشعار', 'Failed to delete logo'));
      }
    } catch (error) {
      console.error('Error deleting logo:', error);
      toast.error(tr('حدث خطأ أثناء حذف الشعار', 'An error occurred while deleting the logo'));
    } finally {
      setIsUploadingLogo(false);
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-4">
          <Loader2 className="h-10 w-10 animate-spin mx-auto text-primary" />
          <p className="text-muted-foreground">{tr('جاري تحميل بيانات الشركة...', 'Loading company data...')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Header */}
      <div className={cn(
        "flex items-start justify-between gap-4",
        isRTL ? "flex-row-reverse" : ""
      )}>
        <div className={cn(isRTL ? "text-right" : "text-left")}>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Building2 className="h-8 w-8 text-primary" />
            {tr('بيانات الشركة', 'Company Profile')}
          </h1>
          <p className="text-muted-foreground mt-2">
            {tr('إدارة معلومات الشركة والهوية البصرية والإعدادات العامة', 'Manage company information, branding and general settings')}
          </p>
        </div>
        
        {/* Save Button */}
        <Button 
          onClick={handleSave}
          disabled={!hasChanges || isSaving}
          className={cn(
            "min-w-[140px]",
            hasChanges ? "bg-primary hover:bg-primary/90" : ""
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
      </div>

      {/* Status Badge */}
      {hasChanges && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center gap-2 text-amber-800">
          <AlertCircle className="h-5 w-5" />
          <span>{tr('لديك تغييرات غير محفوظة', 'You have unsaved changes')}</span>
        </div>
      )}

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Logo Section - Side Panel */}
        <div className="lg:col-span-1">
          <div className="bg-card border rounded-xl p-6 space-y-4 sticky top-4">
            <h3 className="font-semibold text-lg flex items-center gap-2">
              <Camera className="h-5 w-5 text-primary" />
              {tr('شعار الشركة', 'Company Logo')}
            </h3>
            
            {/* Logo Preview */}
            <div className="relative mx-auto w-40 h-40 rounded-xl border-2 border-dashed border-muted-foreground/25 flex items-center justify-center overflow-hidden bg-muted/50 group">
              {form.logo_url ? (
                <>
                  <img 
                    src={form.logo_url} 
                    alt={tr('شعار الشركة', 'Company logo')}
                    className="w-full h-full object-contain p-2"
                  />
                  {/* Overlay on hover */}
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
                      onClick={handleDeleteLogo}
                      disabled={isUploadingLogo}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </>
              ) : (
                <div 
                  className="text-center cursor-pointer p-4"
                  role="button"
                  tabIndex={0}
                  onClick={() => fileInputRef.current?.click()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      fileInputRef.current?.click();
                    }
                  }}
                >
                  {isUploadingLogo ? (
                    <Loader2 className="h-10 w-10 animate-spin mx-auto text-muted-foreground" />
                  ) : (
                    <>
                      <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-2" />
                      <span className="text-sm text-muted-foreground">{tr('اضغط لرفع الشعار', 'Click to upload logo')}</span>
                    </>
                  )}
                </div>
              )}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handleLogoUpload}
            />

            <p className="text-xs text-muted-foreground text-center">
              {tr('JPG, PNG أو WebP', 'JPG, PNG or WebP')}
              <br />
              {tr('الحد الأقصى 5 ميجابايت', 'Maximum size: 5 MB')}
            </p>

            {/* Quick Info */}
            <div className="pt-4 border-t space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <Hash className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">{tr('كود:', 'Code:')}</span>
                <span className="font-mono">{originalData?.code || '-'}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <span className="text-muted-foreground">{tr('الحالة:', 'Status:')}</span>
                <span className="text-green-600">{tr('نشط', 'Active')}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Form Tabs */}
        <div className="lg:col-span-3">
          <Tabs value={activeTab} onValueChange={setActiveTab} dir={isRTL ? 'rtl' : 'ltr'}>
            <TabsList className="grid w-full grid-cols-4 mb-6">
              <TabsTrigger value="basic" className="gap-2">
                <Building className="h-4 w-4" />
                <span className="hidden sm:inline">{tr('الأساسية', 'Basic')}</span>
              </TabsTrigger>
              <TabsTrigger value="contact" className="gap-2">
                <Phone className="h-4 w-4" />
                <span className="hidden sm:inline">{tr('التواصل', 'Contact')}</span>
              </TabsTrigger>
              <TabsTrigger value="address" className="gap-2">
                <MapPin className="h-4 w-4" />
                <span className="hidden sm:inline">{tr('العنوان', 'Address')}</span>
              </TabsTrigger>
              <TabsTrigger value="settings" className="gap-2">
                <Settings2 className="h-4 w-4" />
                <span className="hidden sm:inline">{tr('الإعدادات', 'Settings')}</span>
              </TabsTrigger>
            </TabsList>

            {/* Basic Info Tab */}
            <TabsContent value="basic">
              <div className="bg-card border rounded-xl p-6 space-y-6">
                <div className="flex items-center gap-2 text-lg font-semibold mb-4">
                  <Building className="h-5 w-5 text-primary" />
                  {tr('المعلومات الأساسية', 'Basic Information')}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="name">{tr('اسم الشركة', 'Company Name')}</Label>
                    <Input
                      id="name"
                      value={form.name}
                      onChange={(e) => handleInputChange('name', e.target.value)}
                      placeholder={tr('اسم الشركة الرسمي', 'Official company name')}
                      className={cn(isRTL ? "text-right" : "text-left")}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="name_ar">{tr('الاسم بالعربية', 'Arabic Name')}</Label>
                    <Input
                      id="name_ar"
                      value={form.name_ar}
                      onChange={(e) => handleInputChange('name_ar', e.target.value)}
                      placeholder={tr('اسم الشركة بالعربية', 'Company name in Arabic')}
                      dir="rtl"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="name_en">{tr('الاسم بالإنجليزية', 'English Name')}</Label>
                    <Input
                      id="name_en"
                      value={form.name_en}
                      onChange={(e) => handleInputChange('name_en', e.target.value)}
                      placeholder="Company Name in English"
                      dir="ltr"
                    />
                  </div>
                </div>

                {/* Tax & Registration Info */}
                <div className="pt-6 border-t">
                  <div className="flex items-center gap-2 text-lg font-semibold mb-4">
                    <FileText className="h-5 w-5 text-primary" />
                    {tr('البيانات الضريبية والتجارية', 'Tax & Registration Information')}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="space-y-2">
                      <Label htmlFor="tax_number">{tr('الرقم الضريبي (VAT)', 'VAT Number')}</Label>
                      <Input
                        id="tax_number"
                        value={form.tax_number}
                        onChange={(e) => handleInputChange('tax_number', e.target.value)}
                        placeholder={tr('مثال: 300000000000003', 'Example: 300000000000003')}
                        dir="ltr"
                        className="font-mono"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="commercial_registration">{tr('السجل التجاري', 'Commercial Registration')}</Label>
                      <Input
                        id="commercial_registration"
                        value={form.commercial_registration}
                        onChange={(e) => handleInputChange('commercial_registration', e.target.value)}
                        placeholder={tr('رقم السجل التجاري', 'Commercial registration number')}
                        dir="ltr"
                        className="font-mono"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="license_number">{tr('رقم الترخيص', 'License Number')}</Label>
                      <Input
                        id="license_number"
                        value={form.license_number}
                        onChange={(e) => handleInputChange('license_number', e.target.value)}
                        placeholder={tr('رقم ترخيص النشاط', 'Business license number')}
                        dir="ltr"
                        className="font-mono"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* Contact Tab */}
            <TabsContent value="contact">
              <div className="bg-card border rounded-xl p-6 space-y-6">
                <div className="flex items-center gap-2 text-lg font-semibold mb-4">
                  <Phone className="h-5 w-5 text-primary" />
                  {tr('معلومات التواصل', 'Contact Information')}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="phone">{tr('رقم الهاتف', 'Phone Number')}</Label>
                    <Input
                      id="phone"
                      type="tel"
                      value={form.phone}
                      onChange={(e) => handleInputChange('phone', e.target.value)}
                      placeholder="+966 11 XXX XXXX"
                      dir="ltr"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="mobile">{tr('رقم الجوال', 'Mobile Number')}</Label>
                    <Input
                      id="mobile"
                      type="tel"
                      value={form.mobile}
                      onChange={(e) => handleInputChange('mobile', e.target.value)}
                      placeholder="+966 5X XXX XXXX"
                      dir="ltr"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="email">{tr('البريد الإلكتروني', 'Email Address')}</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="email"
                        type="email"
                        value={form.email}
                        onChange={(e) => handleInputChange('email', e.target.value)}
                        placeholder="info@company.com"
                        dir="ltr"
                        className="pl-10"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="website">{tr('الموقع الإلكتروني', 'Website')}</Label>
                    <div className="relative">
                      <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="website"
                        type="url"
                        value={form.website}
                        onChange={(e) => handleInputChange('website', e.target.value)}
                        placeholder="https://www.company.com"
                        dir="ltr"
                        className="pl-10"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="fax">{tr('رقم الفاكس', 'Fax Number')}</Label>
                    <Input
                      id="fax"
                      type="tel"
                      value={form.fax}
                      onChange={(e) => handleInputChange('fax', e.target.value)}
                      placeholder="+966 11 XXX XXXX"
                      dir="ltr"
                    />
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* Address Tab */}
            <TabsContent value="address">
              <div className="bg-card border rounded-xl p-6 space-y-6">
                <div className="flex items-center gap-2 text-lg font-semibold mb-4">
                  <MapPin className="h-5 w-5 text-primary" />
                  {tr('العنوان', 'Address')}
                </div>

                <div className="space-y-6">
                  <div className="space-y-2">
                    <Label htmlFor="address">{tr('العنوان التفصيلي', 'Detailed Address')}</Label>
                    <Textarea
                      id="address"
                      value={form.address}
                      onChange={(e) => handleInputChange('address', e.target.value)}
                      placeholder={tr('الحي، الشارع، رقم المبنى...', 'District, street and building number...')}
                      rows={3}
                      className={cn(isRTL ? "text-right" : "text-left")}
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    <div className="space-y-2">
                      <Label htmlFor="city">{tr('المدينة', 'City')}</Label>
                      <Input
                        id="city"
                        value={form.city}
                        onChange={(e) => handleInputChange('city', e.target.value)}
                        placeholder={tr('الرياض', 'Riyadh')}
                        className={cn(isRTL ? "text-right" : "text-left")}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="state">{tr('المنطقة', 'Region / State')}</Label>
                      <Input
                        id="state"
                        value={form.state}
                        onChange={(e) => handleInputChange('state', e.target.value)}
                        placeholder={tr('منطقة الرياض', 'Riyadh Region')}
                        className={cn(isRTL ? "text-right" : "text-left")}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="country">{tr('الدولة', 'Country')}</Label>
                      <Input
                        id="country"
                        value={form.country}
                        onChange={(e) => handleInputChange('country', e.target.value)}
                        placeholder={tr('المملكة العربية السعودية', 'Saudi Arabia')}
                        className={cn(isRTL ? "text-right" : "text-left")}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="postal_code">{tr('الرمز البريدي', 'Postal Code')}</Label>
                      <Input
                        id="postal_code"
                        value={form.postal_code}
                        onChange={(e) => handleInputChange('postal_code', e.target.value)}
                        placeholder="12345"
                        dir="ltr"
                        className="font-mono"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* Settings Tab */}
            <TabsContent value="settings">
              <div className="bg-card border rounded-xl p-6 space-y-6">
                {/* Visual Identity */}
                <div>
                  <div className="flex items-center gap-2 text-lg font-semibold mb-4">
                    <Palette className="h-5 w-5 text-primary" />
                    {tr('الهوية البصرية', 'Visual Identity')}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <Label htmlFor="primary_color">{tr('اللون الأساسي', 'Primary Color')}</Label>
                      <div className="flex gap-2">
                        <Input
                          id="primary_color"
                          type="color"
                          value={form.primary_color}
                          onChange={(e) => handleInputChange('primary_color', e.target.value)}
                          className="w-16 h-10 p-1 cursor-pointer"
                        />
                        <Input
                          value={form.primary_color}
                          onChange={(e) => handleInputChange('primary_color', e.target.value)}
                          placeholder="#1e40af"
                          dir="ltr"
                          className="font-mono flex-1"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="secondary_color">{tr('اللون الثانوي', 'Secondary Color')}</Label>
                      <div className="flex gap-2">
                        <Input
                          id="secondary_color"
                          type="color"
                          value={form.secondary_color}
                          onChange={(e) => handleInputChange('secondary_color', e.target.value)}
                          className="w-16 h-10 p-1 cursor-pointer"
                        />
                        <Input
                          value={form.secondary_color}
                          onChange={(e) => handleInputChange('secondary_color', e.target.value)}
                          placeholder="#3b82f6"
                          dir="ltr"
                          className="font-mono flex-1"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Color Preview */}
                  <div className="mt-4 p-4 rounded-lg border bg-muted/30">
                    <span className="text-sm text-muted-foreground mb-2 block">{tr('معاينة الألوان:', 'Color Preview:')}</span>
                    <div className="flex gap-4">
                      <div 
                        className="w-20 h-10 rounded-md shadow-sm"
                        style={{ backgroundColor: form.primary_color }}
                      />
                      <div 
                        className="w-20 h-10 rounded-md shadow-sm"
                        style={{ backgroundColor: form.secondary_color }}
                      />
                      <div 
                        className="flex-1 h-10 rounded-md shadow-sm"
                        style={{ 
                          background: `linear-gradient(90deg, ${form.primary_color}, ${form.secondary_color})`
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* System Settings */}
                <div className="pt-6 border-t">
                  <div className="flex items-center gap-2 text-lg font-semibold mb-4">
                    <Settings2 className="h-5 w-5 text-primary" />
                    {tr('إعدادات النظام', 'System Settings')}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <Label htmlFor="currency">{tr('العملة الافتراضية', 'Default Currency')}</Label>
                      <Select 
                        value={form.currency} 
                        onValueChange={(value) => handleInputChange('currency', value)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={tr('اختر العملة', 'Select currency')} />
                        </SelectTrigger>
                        <SelectContent>
                          {CURRENCIES.map(([value, labelAr, labelEn]) => (
                            <SelectItem key={value} value={value}>
                              {tr(labelAr, labelEn)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="timezone">{tr('المنطقة الزمنية', 'Time Zone')}</Label>
                      <Select 
                        value={form.timezone} 
                        onValueChange={(value) => handleInputChange('timezone', value)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={tr('اختر المنطقة الزمنية', 'Select time zone')} />
                        </SelectTrigger>
                        <SelectContent>
                          {TIMEZONES.map(([value, labelAr, labelEn]) => (
                            <SelectItem key={value} value={value}>
                              {tr(labelAr, labelEn)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="date_format">{tr('تنسيق التاريخ', 'Date Format')}</Label>
                      <Select 
                        value={form.date_format} 
                        onValueChange={(value) => handleInputChange('date_format', value)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={tr('اختر تنسيق التاريخ', 'Select date format')} />
                        </SelectTrigger>
                        <SelectContent>
                          {DATE_FORMATS.map(df => (
                            <SelectItem key={df.value} value={df.value}>
                              {df.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="fiscal_year_start">
                        <div className="flex items-center gap-2">
                          <Calendar className="h-4 w-4" />
                          {tr('بداية السنة المالية', 'Fiscal Year Start')}
                        </div>
                      </Label>
                      <Select 
                        value={String(form.fiscal_year_start)} 
                        onValueChange={(value) => handleInputChange('fiscal_year_start', Number.parseInt(value, 10))}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={tr('اختر الشهر', 'Select month')} />
                        </SelectTrigger>
                        <SelectContent>
                          {FISCAL_MONTHS.map(([value, labelAr, labelEn]) => (
                            <SelectItem key={value} value={String(value)}>
                              {tr(labelAr, labelEn)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}

export default CompanySettings;

