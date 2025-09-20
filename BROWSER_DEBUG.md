# Browser Debug Instructions

This document provides instructions for debugging tenant configuration issues directly in the browser.

## Steps to Debug

1. Open your browser's developer tools (F12 or right-click → Inspect)
2. Go to the Console tab
3. Run the following commands one by one:

### Check Supabase Session

```javascript
// Check if Supabase client is available
console.log('Supabase client:', window.supabase);

// Get current session
window.supabase.auth.getSession().then(({ data, error }) => {
  console.log('Session data:', data);
  console.log('Session error:', error);
  
  if (data?.session) {
    console.log('User ID:', data.session.user.id);
    console.log('User email:', data.session.user.email);
    console.log('User metadata:', data.session.user.user_metadata);
    console.log('Raw user metadata:', data.session.user.raw_user_meta_data);
    console.log('App metadata:', data.session.user.app_metadata);
    
    // Try to decode JWT token
    if (data.session.access_token) {
      try {
        const payload = JSON.parse(atob(data.session.access_token.split('.')[1]));
        console.log('JWT payload:', payload);
        console.log('Tenant ID from JWT:', payload.tenant_id);
        console.log('Org ID from JWT:', payload.org_id);
      } catch (e) {
        console.error('Error decoding JWT:', e);
      }
    }
  }
});
```

### Check GL Accounts

```javascript
// Try to fetch GL accounts
window.supabase.from('gl_accounts').select('*').limit(5).then(({ data, error }) => {
  console.log('GL Accounts (first 5):', data);
  console.log('GL Accounts error:', error);
});

// Try to fetch organizations
window.supabase.from('organizations').select('*').then(({ data, error }) => {
  console.log('Organizations:', data);
  console.log('Organizations error:', error);
});

// Try to fetch user-organization associations
window.supabase.from('user_organizations').select('*').then(({ data, error }) => {
  console.log('User-Organization associations:', data);
  console.log('User-Organization associations error:', error);
});
```

### Check Configuration

```javascript
// Check if config is loaded
fetch('/config.json').then(response => response.json()).then(config => {
  console.log('Config:', config);
  console.log('Supabase URL:', config.SUPABASE_URL);
  console.log('Demo mode:', config.FEATURES?.demo_mode);
});
```

## Common Issues and Solutions

### 1. No session data

If `getSession()` returns no session or an empty session:
- Make sure you're logged in to the application
- Check if the Supabase URL and API key are correct in `config.json`
- Try refreshing the page or logging out and back in

### 2. Missing tenant ID

If the session exists but there's no tenant ID:
- The user may not be associated with an organization
- Run the `fix_user_org_association.sql` script in Supabase
- Check the `auth.users` table in Supabase to see what metadata is available

### 3. Empty GL accounts

If GL accounts query returns no data:
- Check if the `gl_accounts` table has data
- Verify RLS policies are not blocking access
- Ensure the user's tenant ID matches the accounts' tenant IDs

### 4. Configuration issues

If config.json is not loading:
- Make sure the file exists in the public directory
- Check browser network tab for 404 errors
- Verify the file format is correct JSON

## Additional Debugging

### Check all available Supabase methods

```javascript
// List all available methods on the Supabase client
console.log('Supabase methods:', Object.getOwnPropertyNames(window.supabase).filter(name => typeof window.supabase[name] === 'function'));
```

### Check if tables exist

```javascript
// Check if gl_accounts table exists by querying its structure
window.supabase.from('gl_accounts').select('count').limit(1).then(({ data, error }) => {
  if (error) {
    console.log('gl_accounts table error:', error);
    if (error.message.includes('relation') || error.message.includes('not found')) {
      console.log('gl_accounts table may not exist');
    }
  } else {
    console.log('gl_accounts table exists and is accessible');
  }
});
```

## Next Steps

If you're still experiencing issues after running these debug commands:

1. Take screenshots of the console output
2. Check the Network tab in developer tools for any failed requests
3. Look for error messages in the Console tab
4. Try running the SQL diagnostic scripts in Supabase
5. Contact support with the debug information