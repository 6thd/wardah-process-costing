# ⚠️ Security Notice - Archive Scripts

## ⚠️ Important Security Warning

**This directory contains archived/legacy scripts that may contain hardcoded JWT tokens or credentials.**

### 🔒 Security Best Practices:

1. **DO NOT use hardcoded credentials** in any script
2. **Always use environment variables** for sensitive data:
   - `VITE_SUPABASE_URL` or `SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY` or `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_KEY` (for server-side scripts)

3. **These scripts are archived/legacy** and may not follow current security standards
4. **If you need to use any script**, update it to use environment variables

### 📝 Example:

```javascript
// ❌ BAD - Hardcoded token
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';

// ✅ GOOD - Environment variable
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
if (!supabaseKey) {
  throw new Error('SUPABASE_ANON_KEY environment variable is required');
}
```

### 🔄 Migration:

If you need to use any archived script:
1. Copy it to a new location outside of `archive/`
2. Remove all hardcoded credentials
3. Use environment variables instead
4. Update the script to follow current security standards

---

**Note**: SonarQube may flag these files as security issues. These scripts are archived and should not be used in production without security review.

