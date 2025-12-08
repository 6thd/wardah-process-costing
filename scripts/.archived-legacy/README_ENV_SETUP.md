# Environment Variables Setup

## ⚠️ SECURITY WARNING

**Never commit actual API keys to version control!**

This directory contains scripts that require Supabase configuration. All sensitive credentials must be stored in a `.env` file that is **NOT** committed to Git.

## Setup Instructions

1. **Create `.env` file** in this directory (`scripts/.archived-legacy/.env`)

2. **Copy the template** and fill in your actual values:

```bash
# Supabase Configuration
SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key_here
SUPABASE_SERVICE_KEY=your_service_role_key_here
```

3. **Verify `.env` is in `.gitignore`** (it should be already)

4. **Run scripts** - they will automatically load from `.env`

## Environment Variables

- `SUPABASE_URL` - Your Supabase project URL
- `VITE_SUPABASE_ANON_KEY` - Anonymous/public key (safe for client-side)
- `SUPABASE_SERVICE_KEY` - Service role key (⚠️ SECRET - server-side only!)

## Scripts Updated

All scripts in this directory have been updated to:
- ✅ Load configuration from `.env` file
- ✅ Fail fast if environment variables are missing
- ✅ Show clear error messages
- ✅ Never hardcode API keys

## Getting Your Keys

1. Go to your Supabase project dashboard
2. Navigate to Settings → API
3. Copy:
   - **Project URL** → `SUPABASE_URL`
   - **anon public** key → `VITE_SUPABASE_ANON_KEY`
   - **service_role secret** key → `SUPABASE_SERVICE_KEY` (⚠️ Keep secret!)

## Security Best Practices

1. ✅ Use `.env` for all secrets
2. ✅ Never commit `.env` to Git
3. ✅ Use `VITE_SUPABASE_ANON_KEY` for client-side operations
4. ✅ Use `SUPABASE_SERVICE_KEY` only for server-side/admin scripts
5. ✅ Rotate keys if they are ever exposed
6. ✅ Use different keys for development and production

