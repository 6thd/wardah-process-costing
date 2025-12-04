# 🔐 حل بديل مجاني: التحقق من كلمات المرور المسربة

## 📋 **الملخص**

بما أن **Leaked Password Protection** في Supabase يحتاج Pro plan ($25/شهر)، يمكن تطبيق حل بديل مجاني باستخدام **Have I Been Pwned API**.

---

## 🎯 **الهدف**

منع المستخدمين من استخدام كلمات المرور المسربة (compromised passwords) بدون الحاجة لترقية Supabase.

---

## 📦 **الحل: استخدام `hibp` Library**

### **المكتبة:**
```bash
npm install hibp
```

**الرابط:** https://www.npmjs.com/package/hibp

---

## 🚀 **التنفيذ**

### **الخطوة 1: تثبيت المكتبة**

```bash
npm install hibp
```

### **الخطوة 2: إنشاء Password Validator**

**الملف:** `src/lib/auth/password-validator.ts`

```typescript
import { pwnedPassword } from 'hibp';

/**
 * Validates if a password has been leaked (compromised)
 * Uses Have I Been Pwned API (free tier)
 * 
 * @param password - The password to check
 * @returns Promise<boolean> - true if password is safe, false if leaked
 */
export async function validatePasswordNotLeaked(
  password: string
): Promise<{ isSafe: boolean; count?: number }> {
  try {
    // Check if password appears in Have I Been Pwned database
    const count = await pwnedPassword(password);
    
    if (count > 0) {
      return {
        isSafe: false,
        count, // Number of times this password was found in breaches
      };
    }
    
    return { isSafe: true };
  } catch (error) {
    // If API fails, allow password (fail open for availability)
    // In production, you might want to fail closed
    console.error('Error checking password against HIBP:', error);
    return { isSafe: true }; // Fail open
  }
}

/**
 * Validates password strength and checks if it's leaked
 * 
 * @param password - The password to validate
 * @returns Promise<{ isValid: boolean; errors: string[] }>
 */
export async function validatePassword(
  password: string
): Promise<{ isValid: boolean; errors: string[] }> {
  const errors: string[] = [];
  
  // Basic strength checks
  if (password.length < 8) {
    errors.push('Password must be at least 8 characters long');
  }
  
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }
  
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }
  
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }
  
  if (!/[^A-Za-z0-9]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }
  
  // Check if password is leaked
  const { isSafe, count } = await validatePasswordNotLeaked(password);
  
  if (!isSafe) {
    errors.push(
      `This password has been found in ${count} data breaches. Please choose a different password.`
    );
  }
  
  return {
    isValid: errors.length === 0,
    errors,
  };
}
```

### **الخطوة 3: استخدامه في Sign Up Form**

**الملف:** `src/pages/auth/signup.tsx` (أو الملف المناسب)

```typescript
import { validatePassword } from '@/lib/auth/password-validator';
import { useState } from 'react';

export function SignUpForm() {
  const [password, setPassword] = useState('');
  const [passwordErrors, setPasswordErrors] = useState<string[]>([]);
  const [isCheckingPassword, setIsCheckingPassword] = useState(false);

  const handlePasswordChange = async (newPassword: string) => {
    setPassword(newPassword);
    
    // Debounce the check (wait 500ms after user stops typing)
    setIsCheckingPassword(true);
    
    setTimeout(async () => {
      const { isValid, errors } = await validatePassword(newPassword);
      setPasswordErrors(errors);
      setIsCheckingPassword(false);
    }, 500);
  };

  return (
    <form>
      <input
        type="password"
        value={password}
        onChange={(e) => handlePasswordChange(e.target.value)}
        placeholder="Password"
      />
      
      {isCheckingPassword && (
        <p>Checking password security...</p>
      )}
      
      {passwordErrors.length > 0 && (
        <div className="text-red-500">
          {passwordErrors.map((error, index) => (
            <p key={index}>{error}</p>
          ))}
        </div>
      )}
      
      <button 
        type="submit"
        disabled={passwordErrors.length > 0}
      >
        Sign Up
      </button>
    </form>
  );
}
```

### **الخطوة 4: استخدامه في Password Change**

**الملف:** `src/pages/settings/change-password.tsx`

```typescript
import { validatePassword } from '@/lib/auth/password-validator';

export function ChangePasswordForm() {
  const [newPassword, setNewPassword] = useState('');
  const [passwordErrors, setPasswordErrors] = useState<string[]>([]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const { isValid, errors } = await validatePassword(newPassword);
    
    if (!isValid) {
      setPasswordErrors(errors);
      return;
    }
    
    // Proceed with password change
    // ... your password change logic
  };

  // ... rest of component
}
```

---

## ⚙️ **الإعدادات المتقدمة**

### **Option 1: Rate Limiting**

```typescript
import { pwnedPassword } from 'hibp';

// Cache results to avoid hitting API limits
const passwordCache = new Map<string, { isSafe: boolean; timestamp: number }>();
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

export async function validatePasswordNotLeaked(
  password: string
): Promise<{ isSafe: boolean; count?: number }> {
  // Check cache first
  const cached = passwordCache.get(password);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return { isSafe: cached.isSafe };
  }
  
  try {
    const count = await pwnedPassword(password);
    const isSafe = count === 0;
    
    // Cache result
    passwordCache.set(password, { isSafe, timestamp: Date.now() });
    
    return { isSafe, count: count > 0 ? count : undefined };
  } catch (error) {
    console.error('Error checking password:', error);
    return { isSafe: true }; // Fail open
  }
}
```

### **Option 2: Debouncing**

```typescript
import { debounce } from 'lodash';

const debouncedPasswordCheck = debounce(
  async (password: string, callback: (errors: string[]) => void) => {
    const { errors } = await validatePassword(password);
    callback(errors);
  },
  500 // Wait 500ms after user stops typing
);
```

---

## 📊 **المقارنة**

| الميزة | Supabase Pro | HIBP (Free) |
|--------|--------------|-------------|
| **التكلفة** | $25/شهر | $0 |
| **التكامل** | تلقائي | يدوي |
| **API Limits** | غير محدود | محدود (لكن كافي) |
| **السرعة** | سريع جداً | سريع |
| **الموثوقية** | عالية | جيدة |

---

## ⚠️ **التحذيرات**

1. **API Limits:**
   - HIBP API مجاني لكن محدود
   - استخدم caching لتقليل الطلبات
   - استخدم debouncing لتقليل الطلبات

2. **Fail Open vs Fail Closed:**
   - الحل الحالي: **Fail Open** (إذا فشل API، يسمح بكلمة المرور)
   - للإنتاج: يمكن تغييره لـ **Fail Closed** (إذا فشل API، يرفض كلمة المرور)

3. **Privacy:**
   - HIBP يستخدم k-anonymity (آمن)
   - لا يتم إرسال كلمة المرور كاملة

---

## ✅ **الفوائد**

1. ✅ **مجاني تماماً**
2. ✅ **سهل التطبيق**
3. ✅ **متوافق مع Supabase Free plan**
4. ✅ **يمكن إزالته عند الترقية لـ Pro**

---

## 🔄 **الانتقال لـ Supabase Pro**

عند الترقية لـ Pro plan، يمكنك:

1. **إزالة الكود اليدوي** (اختياري)
2. **تفعيل Leaked Password Protection** من Dashboard
3. **الحفاظ على الكود كـ fallback** (اختياري)

---

## 📝 **Checklist التنفيذ**

- [ ] تثبيت `hibp` library
- [ ] إنشاء `password-validator.ts`
- [ ] تطبيق في Sign Up form
- [ ] تطبيق في Change Password form
- [ ] إضافة caching (اختياري)
- [ ] إضافة debouncing (اختياري)
- [ ] اختبار التكامل

---

## 🔗 **الروابط**

- [HIBP npm package](https://www.npmjs.com/package/hibp)
- [Have I Been Pwned API](https://haveibeenpwned.com/API/v3)
- [Supabase Auth Security](https://supabase.com/docs/guides/auth/password-security)

---

**التكلفة:** $0  
**الوقت المتوقع:** 1-2 ساعة  
**الفائدة:** حماية كلمات المرور بدون تكلفة إضافية

