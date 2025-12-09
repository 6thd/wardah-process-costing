# تحليل Security Hotspots - SonarQube

**تاريخ التحليل:** 8 ديسمبر 2025  
**إجمالي Hotspots:** 28 (مقدر)

---

## 🔴 Critical Security Hotspots (أولوية عالية)

### 1. Hardcoded Credentials
**الملف:** `src/store/auth-store.ts:44`  
**المشكلة:**
```typescript
if (email === 'admin@wardah.sa' && password === 'admin123') {
```
**الخطورة:** 🔴 **Critical**
- كلمة مرور hardcoded في الكود
- يمكن لأي شخص رؤية الكود الوصول إلى الحساب

**الحل:**
- إزالة hardcoded credentials
- استخدام environment variables
- استخدام Supabase Auth فقط

---

### 2. SQL Injection Risk
**الملف:** `src/database/execute-migrations.ts:25-42`  
**المشكلة:**
```typescript
const sql = fs.readFileSync(filePath, 'utf8');
const statements = sql.split(';').filter(s => s.trim());
await supabase.rpc('execute_sql', { sql: statement });
```
**الخطورة:** 🔴 **Critical**
- تنفيذ SQL مباشر من ملفات
- لا يوجد validation أو sanitization

**الحل:**
- استخدام parameterized queries
- التحقق من محتوى SQL files قبل التنفيذ
- استخدام Supabase migrations بدلاً من raw SQL

---

### 3. XSS Vulnerabilities (innerHTML)
**الملفات:**
- `src/ui/events.ts:216`
- `src/features/manufacturing/stage-costing-actions.js:45, 69, 356, 392`
- `src/features/reports/components/GeminiDashboard.tsx:185, 188`
- `js/ui/renderers.js:54, 89`

**المشكلة:**
```typescript
element.innerHTML = '<span class="spinner"></span> Loading...'
container.innerHTML = html;
reportWindow.document.write(`...`);
```
**الخطورة:** 🔴 **Critical**
- استخدام `innerHTML` و `document.write` يسمح بـ XSS attacks
- أي user input يمكن أن يحتوي على malicious scripts

**الحل:**
- استخدام `textContent` بدلاً من `innerHTML`
- استخدام React's JSX بدلاً من string concatenation
- استخدام DOMPurify لتنظيف HTML إذا كان ضرورياً

---

### 4. localStorage Security
**الملفات:**
- `src/hooks/usePermissions.ts:69`
- `src/contexts/AuthContext.tsx:36, 79, 91, 108, 191, 223, 265`

**المشكلة:**
```typescript
safeLocalStorage.getItem('current_org_id')
safeLocalStorage.setItem('current_org_id', orgId)
```
**الخطورة:** 🟡 **Medium**
- localStorage يمكن الوصول إليه من JavaScript
- قد يحتوي على بيانات حساسة (org_id, user data)

**الحل:**
- استخدام httpOnly cookies للبيانات الحساسة
- تشفير البيانات قبل حفظها في localStorage
- استخدام sessionStorage بدلاً من localStorage للبيانات المؤقتة

---

## 🟡 Medium Security Hotspots

### 5. Missing Input Validation
**الملفات:**
- `src/core/security.ts:276-289` (sanitizeInput موجود لكن غير مستخدم في كل مكان)
- `src/ui/events.ts:172-174` (FormData بدون validation)

**المشكلة:**
```typescript
const formData = new FormData(element)
for (const [key, value] of formData.entries()) {
  data[key] = value  // No validation!
}
```
**الخطورة:** 🟡 **Medium**
- لا يوجد validation للـ user inputs
- قد يؤدي إلى injection attacks

**الحل:**
- استخدام `sanitizeInput` في جميع المدخلات
- إضافة schema validation (zod, yup)
- استخدام TypeScript types للتحقق

---

### 6. Hardcoded URLs and Endpoints
**الملفات:**
- `public/config.json:56`
- `src/features/reports/proxy-service/config.ts:28`
- `src/services/gemini-service.ts:12`

**المشكلة:**
```typescript
proxy_url: "http://localhost:3001/api/wardah"
apiEndpoint: process.env.WARDAH_API_ENDPOINT || 'http://localhost:8000'
```
**الخطورة:** 🟡 **Medium**
- Hardcoded URLs في production code
- قد تكشف عن infrastructure details

**الحل:**
- استخدام environment variables فقط
- إزالة fallback values في production
- استخدام config files منفصلة للـ environments

---

### 7. Missing Authentication Checks
**الملفات:**
- `src/core/security.ts:155-175` (withSecurity موجود لكن غير مستخدم في كل مكان)

**المشكلة:**
- بعض API calls لا تتحقق من authentication
- بعض components لا تتحقق من user permissions

**الخطورة:** 🟡 **Medium**
- قد يسمح بالوصول غير المصرح به

**الحل:**
- استخدام `withSecurity` wrapper في جميع API calls
- إضافة permission checks في جميع components
- استخدام ProtectedRoute للصفحات الحساسة

---

### 8. Exposed Environment Variables
**الملفات:**
- `src/features/reports/proxy-service/config.ts:17-36`
- `src/features/reports/proxy-service/server.ts:24-66`

**المشكلة:**
```typescript
process.env.WARDAH_API_KEY || 'dev_key'  // Hardcoded fallback!
```
**الخطورة:** 🟡 **Medium**
- Fallback values قد تكشف عن secrets
- Environment variables قد تكون exposed في client-side code

**الحل:**
- إزالة جميع fallback values
- استخدام server-side only environment variables
- استخدام secrets management (Vault, AWS Secrets Manager)

---

## 🟢 Low Security Hotspots

### 9. Missing HTTPS Enforcement
**الملفات:**
- `src/services/gemini-service.ts:66, 80`

**المشكلة:**
```typescript
const response = await fetch(`${this.proxyUrl}/financial-data`, {
```
**الخطورة:** 🟢 **Low**
- لا يوجد enforcement لـ HTTPS
- قد يسمح بـ man-in-the-middle attacks

**الحل:**
- استخدام HTTPS فقط في production
- إضافة HSTS headers
- استخدام certificate pinning

---

### 10. Missing Rate Limiting
**الملفات:**
- `src/core/security.ts:246-271` (checkRateLimit موجود لكن غير مستخدم)

**المشكلة:**
- Rate limiting موجود لكن غير مستخدم في جميع endpoints

**الخطورة:** 🟢 **Low**
- قد يسمح بـ DoS attacks

**الحل:**
- استخدام `checkRateLimit` في جميع API endpoints
- إضافة rate limiting على مستوى Supabase
- استخدام CDN rate limiting

---

### 11. Missing CSRF Protection
**المشكلة:**
- لا يوجد CSRF tokens في forms

**الخطورة:** 🟢 **Low**
- قد يسمح بـ CSRF attacks

**الحل:**
- إضافة CSRF tokens
- استخدام SameSite cookies
- استخدام double-submit cookies

---

### 12. Missing Content Security Policy (CSP)
**المشكلة:**
- لا يوجد CSP headers

**الخطورة:** 🟢 **Low**
- قد يسمح بـ XSS attacks

**الحل:**
- إضافة CSP headers
- استخدام nonce-based CSP
- تقييد inline scripts

---

## 📋 قائمة كاملة بـ 28 Hotspots (مقدر)

### Critical (4)
1. ✅ Hardcoded credentials (`auth-store.ts`)
2. ✅ SQL injection risk (`execute-migrations.ts`)
3. ✅ XSS vulnerabilities - innerHTML (8 ملفات)
4. ✅ localStorage security (7 ملفات)

### Medium (4)
5. ✅ Missing input validation (2 ملفات)
6. ✅ Hardcoded URLs (3 ملفات)
7. ✅ Missing authentication checks
8. ✅ Exposed environment variables (2 ملفات)

### Low (4)
9. ✅ Missing HTTPS enforcement
10. ✅ Missing rate limiting
11. ✅ Missing CSRF protection
12. ✅ Missing CSP headers

### Additional Hotspots (16) - تحتاج مراجعة في SonarQube:
13-28. (سيتم تحديثها بعد مراجعة SonarQube Dashboard)

---

## 🎯 خطة الإصلاح

### المرحلة 1: Critical Issues (أسبوع 1)
- [ ] إزالة hardcoded credentials
- [ ] إصلاح SQL injection risks
- [ ] إصلاح XSS vulnerabilities (innerHTML)
- [ ] تحسين localStorage security

### المرحلة 2: Medium Issues (أسبوع 2)
- [ ] إضافة input validation
- [ ] إزالة hardcoded URLs
- [ ] إضافة authentication checks
- [ ] إصلاح environment variables exposure

### المرحلة 3: Low Issues (أسبوع 3)
- [ ] إضافة HTTPS enforcement
- [ ] تفعيل rate limiting
- [ ] إضافة CSRF protection
- [ ] إضافة CSP headers

---

## 🔗 روابط مفيدة

- **SonarQube Security Hotspots:** https://sonarcloud.io/project/security_hotspots?id=YOUR_PROJECT
- **OWASP Top 10:** https://owasp.org/www-project-top-ten/
- **XSS Prevention:** https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html
- **SQL Injection Prevention:** https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html

---

**آخر تحديث:** 8 ديسمبر 2025  
**الحالة:** ⚠️ **يحتاج إصلاح فوري**

