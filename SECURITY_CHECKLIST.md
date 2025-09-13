# 🚨 SECURITY CHECKLIST - BEFORE PRODUCTION DEPLOYMENT

## ⚠️ CRITICAL SECURITY ITEMS TO ADDRESS

### 1. Remove Demo/Debug Code
- [x] Delete `debug-auth.js` (COMPLETED)
- [ ] Remove demo credentials from `src/store/auth-store.ts`
- [ ] Remove demo credentials from `src/features/auth/login.tsx`
- [ ] Remove `src/setup-supabase.ts` (contains hardcoded credentials)
- [ ] Remove `src/debug-auth.ts` (contains hardcoded credentials)
- [ ] Remove debug imports from `src/App.tsx` (COMPLETED)

### 2. Environment Variables Setup
- [ ] Create proper `.env` file (DO NOT commit to Git)
- [ ] Move all Supabase credentials to environment variables
- [ ] Update `config.json` to use placeholder values only
- [ ] Configure production environment variables on hosting platform

### 3. Supabase Security Configuration
- [ ] Enable Row Level Security (RLS) on all tables
- [ ] Configure proper authentication policies
- [ ] Remove test/demo users from Supabase Auth
- [ ] Rotate Supabase API keys if exposed
- [ ] Configure proper CORS settings
- [ ] Set up proper database backup strategies

### 4. Code Security
- [ ] Remove all console.log statements containing sensitive data
- [ ] Implement proper error handling (avoid exposing internal errors)
- [ ] Add input validation and sanitization
- [ ] Implement rate limiting for API calls
- [ ] Add CSRF protection if needed

### 5. Files to Review/Remove Before Production
```
src/debug-auth.ts          - Contains hardcoded credentials
src/setup-supabase.ts      - Contains demo user setup
debug-auth.js              - REMOVED ✅
```

### 6. Configuration Files Security
- [ ] Ensure `config.json` contains only placeholder values
- [ ] Add `*.env*` to `.gitignore` 
- [ ] Review all JSON config files for sensitive data
- [ ] Use environment-specific configuration files

### 7. Git Repository Security
- [ ] Review Git history for accidentally committed secrets
- [ ] Use `git filter-branch` or BFG tool if secrets were committed
- [ ] Add comprehensive `.gitignore` for sensitive files
- [ ] Consider using Git hooks to prevent secret commits

## 🔒 PRODUCTION SECURITY BEST PRACTICES

### Environment Variables Template (.env)
```bash
# Supabase Configuration
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-actual-anon-key-here

# App Configuration  
VITE_APP_ENV=production
VITE_API_BASE_URL=https://your-api.com
```

### Supabase RLS Policies Example
```sql
-- Example RLS policy for users table
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own data" ON users
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own data" ON users  
  FOR UPDATE USING (auth.uid() = id);
```

## ⚡ IMMEDIATE ACTIONS REQUIRED

1. **URGENT**: Remove/rotate exposed Supabase credentials
2. **HIGH**: Remove all demo authentication code
3. **HIGH**: Set up proper environment variable configuration
4. **MEDIUM**: Implement RLS policies in Supabase
5. **MEDIUM**: Review and secure all API endpoints

## 📋 Pre-Deployment Verification

- [ ] No hardcoded credentials in codebase
- [ ] All sensitive data moved to environment variables
- [ ] Environment variables configured on hosting platform
- [ ] Supabase RLS policies enabled and tested
- [ ] Demo/debug code completely removed
- [ ] Git repository cleaned of any committed secrets
- [ ] Error messages don't expose sensitive information
- [ ] HTTPS enforced in production
- [ ] Database backups configured
- [ ] Monitoring and logging set up (without logging sensitive data)

---
**⚠️ DO NOT DEPLOY TO PRODUCTION UNTIL ALL ITEMS ARE COMPLETED**