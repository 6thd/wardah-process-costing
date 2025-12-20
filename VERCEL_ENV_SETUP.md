# 🚀 Vercel Environment Variables Setup

## ⚠️ Critical Issue
The production app on Vercel is missing Supabase environment variables, causing the app to fail.

## 🔧 Solution

### Option 1: Via Vercel Dashboard (Recommended)

1. Go to: https://vercel.com/dashboard
2. Select project: `wardah-process-costing`
3. Navigate to: **Settings** → **Environment Variables**
4. Add the following variables:

#### Variable 1: VITE_SUPABASE_URL
```
Name: VITE_SUPABASE_URL
Value: <YOUR_SUPABASE_PROJECT_URL>
Environments: ✓ Production ✓ Preview ✓ Development
```

#### Variable 2: VITE_SUPABASE_ANON_KEY
```
Name: VITE_SUPABASE_ANON_KEY
Value: <YOUR_SUPABASE_ANON_KEY>
Environments: ✓ Production ✓ Preview ✓ Development
```

> ⚠️ **SECURITY NOTE**: Get your actual keys from Supabase Dashboard → Settings → API

5. Click **Save**
6. Go to **Deployments** → Select latest deployment → Click **Redeploy**

---

### Option 2: Via Vercel CLI

If you have Vercel CLI installed:

```bash
# Install Vercel CLI (if not installed)
npm i -g vercel

# Login to Vercel
vercel login

# Link your project
vercel link

# Add environment variables
vercel env add VITE_SUPABASE_URL production
# Paste your Supabase URL from dashboard

vercel env add VITE_SUPABASE_ANON_KEY production
# Paste your anon key from Supabase Dashboard → Settings → API

# Also add for preview and development
vercel env add VITE_SUPABASE_URL preview
vercel env add VITE_SUPABASE_ANON_KEY preview

vercel env add VITE_SUPABASE_URL development
vercel env add VITE_SUPABASE_ANON_KEY development

# Redeploy
vercel --prod
```

---

## ✅ Verification

After redeploying, check:

1. Visit: https://wardah-process-costing.vercel.app/
2. Open browser console (F12)
3. You should NOT see the error anymore
4. The app should load correctly

---

## 🔐 Security Notes

- ✅ The ANON_KEY is safe to expose in frontend code
- ✅ It's protected by Supabase RLS policies
- ⚠️ Never commit .env file to Git (already in .gitignore)
- ⚠️ If you suspect the key is compromised, regenerate it from Supabase dashboard

---

## 📚 References

- Vercel Environment Variables: https://vercel.com/docs/environment-variables
- Supabase API Keys: https://supabase.com/docs/guides/api/api-keys
