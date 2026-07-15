import { describe, it, expect, beforeEach } from 'vitest';
import i18n from '../i18n';

describe('i18n Configuration', () => {
  beforeEach(async () => {
    // Ensure i18n is initialized
    if (!i18n.isInitialized) {
      await i18n.init();
    }
  });

  it('should initialize i18n successfully', () => {
    expect(i18n).toBeDefined();
    expect(i18n.isInitialized).toBe(true);
  });

  it('should have Arabic as fallback language', () => {
    expect(i18n.options.fallbackLng).toContain('ar');
  });

  it('should load Arabic translations', () => {
    expect(i18n.hasResourceBundle('ar', 'translation')).toBe(true);
  });

  it('should load English translations', () => {
    expect(i18n.hasResourceBundle('en', 'translation')).toBe(true);
  });

  it('should translate Arabic keys', async () => {
    await i18n.changeLanguage('ar');
    const translation = i18n.t('common.save');
    expect(translation).toBeDefined();
    expect(translation).not.toBe('common.save');
  });

  it('should translate English keys', async () => {
    await i18n.changeLanguage('en');
    const translation = i18n.t('common.save');
    expect(translation).toBeDefined();
    expect(translation).not.toBe('common.save');
  });

  it('should change language', async () => {
    await i18n.changeLanguage('en');
    expect(i18n.language).toBe('en');
    
    await i18n.changeLanguage('ar');
    expect(i18n.language).toBe('ar');
  });

  it('should have interpolation settings', () => {
    expect(i18n.options.interpolation?.escapeValue).toBe(false);
  });

  it('should normalize region codes and restrict to supported languages', () => {
    // ar-SA → ar حتى تصح المقارنات الصارمة i18n.language === 'ar' في الشاشات
    expect(i18n.options.load).toBe('languageOnly');
    expect(i18n.options.supportedLngs).toContain('ar');
    expect(i18n.options.supportedLngs).toContain('en');
  });

  it('should resolve region-qualified codes to base language', async () => {
    // i18n.language يبقى كما طُلب؛ resolvedLanguage هو المطبَّع الذي تُحمَّل به الموارد
    await i18n.changeLanguage('ar-SA');
    expect(i18n.resolvedLanguage).toBe('ar');
    await i18n.changeLanguage('en-US');
    expect(i18n.resolvedLanguage).toBe('en');
    // مسار التطبيق الفعلي: المبدّل مقيّد بـ 'ar' | 'en' ⇒ المقارنات الصارمة موثوقة
    await i18n.changeLanguage('ar');
    expect(i18n.language).toBe('ar');
  });

  it('should have React options configured', () => {
    expect(i18n.options.react?.useSuspense).toBe(false);
  });

  it('should handle missing keys gracefully', () => {
    const result = i18n.t('nonexistent.key.path');
    expect(result).toBeDefined();
  });
});
