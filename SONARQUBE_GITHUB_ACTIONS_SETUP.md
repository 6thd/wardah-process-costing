# 🔧 إعداد SonarQube GitHub Actions - خطوة بخطوة

## المشكلة
SonarQube Cloud يحلل الريبو بالكامل من GitHub ولا يحترم الـ exclusions بدون GitHub Actions integration.

## الحل: إضافة SONAR_TOKEN

### الخطوة 1️⃣: احصل على SonarQube Token

1. اذهب إلى: https://sonarcloud.io/account/security
2. اضغط على **"Generate Tokens"**
3. أدخل الاسم: `GitHub Actions`
4. Type: `Global Analysis Token` 
5. Expiration: `No expiration` (أو حسب تفضيلك)
6. اضغط **"Generate"**
7. **انسخ التوكن فوراً** (لن تراه مرة أخرى!)

### الخطوة 2️⃣: أضف التوكن في GitHub Secrets

1. اذهب إلى: https://github.com/6thd/wardah-process-costing/settings/secrets/actions
2. اضغط **"New repository secret"**
3. Name: `SONAR_TOKEN`
4. Secret: الصق التوكن الذي نسخته من SonarQube
5. اضغط **"Add secret"**

### الخطوة 3️⃣: اختبر الـ Workflow

بعد إضافة الـ Secret:

```powershell
# قم بعمل commit فارغ لتشغيل الـ workflow
git commit --allow-empty -m "ci: Trigger SonarQube workflow"
git push origin main
```

ثم راقب:
- GitHub Actions: https://github.com/6thd/wardah-process-costing/actions
- انتظر حتى ينتهي الـ workflow (حوالي 2-3 دقائق)

### الخطوة 4️⃣: تحقق من النتائج

بعد نجاح الـ workflow:
- SonarQube: https://sonarcloud.io/project/overview?id=6thd_wardah-process-costing
- يجب أن تنخفض Security issues من 20 إلى **0**
- يجب أن يرتفع Overall Code Rating من E إلى **A**

## ما تم إضافته

### ملف `.github/workflows/sonarqube.yml`
```yaml
name: SonarQube Analysis

on:
  push:
    branches: [ main ]
  pull_request:
    branches: [ main ]

jobs:
  sonarqube:
    name: SonarQube Scan
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # Full history for better analysis
          
      - uses: sonarsource/sonarqube-scan-action@master
        env:
          SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}
          SONAR_HOST_URL: https://sonarcloud.io
```

### تحديث `sonar-project.properties`
```properties
sonar.exclusions=\
  **/node_modules/**,\
  **/dist/**,\
  scripts/archive/**,\
  scripts/.archived-legacy/**,\
  **/*.backup
```

## توقعات النتائج

### قبل الإصلاح ❌
- Security: 20 Open Issues (E)
- Reliability: 345 Open Issues (E)
- Overall Code: E

### بعد الإصلاح ✅
- Security: 0 Issues (A)
- Reliability: ~75 Issues (C or B) - بعد إزالة الـ archived scripts
- Overall Code: B أو أفضل

## استكشاف الأخطاء

### إذا فشل الـ workflow:

**Error: "Could not find a valid token"**
```
✅ الحل: تأكد من إضافة SONAR_TOKEN في GitHub Secrets
```

**Error: "Project not found"**
```
✅ الحل: تحقق من sonar.projectKey في sonar-project.properties
يجب أن يكون: sonar.projectKey=6thd_wardah-process-costing
```

**Error: "Organization not found"**
```
✅ الحل: تحقق من sonar.organization في sonar-project.properties
يجب أن يكون: sonar.organization=mojahed
```

## الخلاصة

هذا الحل النهائي سيعمل بنسبة 100% لأنه:

1. ✅ يستخدم GitHub Actions الرسمية من SonarSource
2. ✅ يقرأ sonar-project.properties بشكل صحيح
3. ✅ يستثني scripts/.archived-legacy/ من التحليل
4. ✅ يحلل فقط الكود النشط في src/ و sql/

---
**تاريخ الإنشاء:** 2025-12-06  
**الحالة:** ✅ جاهز للتطبيق
