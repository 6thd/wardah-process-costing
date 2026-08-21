/**
 * Company Settings / Profile Component
 * مكون إعدادات وملف الشركة
 * Multi-tenant Support
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { 
  Phone, 
  Mail, 
  Globe, 
  MapPin, 
  FileText,
  Palette,
  Settings2,
  Building,
  Calendar
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { usePermissions } from '@/hooks/usePermissions';
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
import {
  CompanyLogoPanel,
  CompanySettingsHeader,
  CompanySettingsLoading,
} from './CompanySettingsSections';
import {
  initialCompanySettingsFormState,
  mapOrganizationToCompanySettingsForm,
  type CompanySettingsFormState,
} from './companySettingsForm';

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
  const { hasPermissionKey } = usePermissions();
  // حفظ الملف الشخصي للشركة ورفع/حذف الشعار كلها كتابة على صف organizations
  // نفسه — settings.organization.update هو المفتاح الحقيقي المطابق، بصرف
  // النظر عن أن دخول الشاشة نفسه محكوم بـ settings.organization.read فقط.
  const canUpdate = hasPermissionKey('settings.organization.update');

  // State
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [form, setForm] = useState<CompanySettingsFormState>(initialCompanySettingsFormState);
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
        const formValue = form[key as keyof CompanySettingsFormState];
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
        setForm(mapOrganizationToCompanySettingsForm(result.data));
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

  const handleInputChange = useCallback((field: keyof CompanySettingsFormState, value: string | number) => {
    setForm(prev => ({ ...prev, [field]: value }));
  }, []);

  const handleSave = async () => {
    if (!canUpdate) {
      toast.error(tr('لا تملك صلاحية تعديل بيانات الشركة', 'You do not have permission to update company data'));
      return;
    }
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
    if (!canUpdate) {
      toast.error(tr('لا تملك صلاحية تعديل بيانات الشركة', 'You do not have permission to update company data'));
      return;
    }

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
    if (!canUpdate) {
      toast.error(tr('لا تملك صلاحية تعديل بيانات الشركة', 'You do not have permission to update company data'));
      return;
    }

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
    return <CompanySettingsLoading tr={tr} />;
  }

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <CompanySettingsHeader
        isRTL={isRTL}
        canUpdate={canUpdate}
        hasChanges={hasChanges}
        isSaving={isSaving}
        onSave={handleSave}
        tr={tr}
      />

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <CompanyLogoPanel
          logoUrl={form.logo_url}
          organizationCode={originalData?.code}
          canUpdate={canUpdate}
          isUploadingLogo={isUploadingLogo}
          fileInputRef={fileInputRef}
          onLogoUpload={handleLogoUpload}
          onDeleteLogo={handleDeleteLogo}
          tr={tr}
        />

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
