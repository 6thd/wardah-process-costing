# Environment Configuration Guide

## Overview

This document describes the different environments used in the Wardah ERP system and how to configure them.

## Environments

### Development

**Purpose:** Local development and testing

**Configuration:**
- Uses local Supabase instance or development project
- Debug mode enabled
- Hot reload enabled
- Detailed error messages
- No production optimizations

**Environment File:** `.env.development`

```bash
VITE_APP_ENV=development
VITE_SUPABASE_URL=http://localhost:54321
VITE_SUPABASE_ANON_KEY=your_dev_anon_key
```

### Staging

**Purpose:** Pre-production testing and QA

**Configuration:**
- Uses staging Supabase project
- Production-like optimizations
- Error tracking enabled
- Limited analytics
- Test data allowed

**Environment File:** `.env.staging`

```bash
VITE_APP_ENV=staging
VITE_SUPABASE_URL=https://your-staging-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_staging_anon_key
VITE_SENTRY_DSN=your_staging_sentry_dsn
```

### Production

**Purpose:** Live production system

**Configuration:**
- Uses production Supabase project
- Full optimizations
- Error tracking required
- Analytics enabled
- No debug features

**Environment File:** `.env.production`

```bash
VITE_APP_ENV=production
VITE_SUPABASE_URL=https://your-production-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_production_anon_key
VITE_SENTRY_DSN=your_production_sentry_dsn
VITE_GA_ID=your_google_analytics_id
VITE_ENCRYPTION_KEY=your_32_char_encryption_key
```

## Environment Variables

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `VITE_SUPABASE_URL` | Supabase project URL | `https://xxx.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Supabase anonymous key | `eyJhbGc...` |
| `VITE_APP_ENV` | Environment name | `development`, `staging`, `production` |

### Optional Variables

| Variable | Description | When Required |
|----------|-------------|---------------|
| `VITE_SENTRY_DSN` | Sentry error tracking DSN | Production, Staging |
| `VITE_GA_ID` | Google Analytics ID | Production |
| `VITE_ENCRYPTION_KEY` | Encryption key for sensitive data | Production |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (server-side only) | Backend operations |

## Setup Instructions

### 1. Development Setup

```bash
# Copy example file
cp .env.example .env.development

# Edit with your values
nano .env.development

# Validate
npm run validate-env
```

### 2. Staging Setup

```bash
# Copy example file
cp .env.example .env.staging

# Edit with staging values
nano .env.staging

# Validate
npm run validate-env:staging
```

### 3. Production Setup

```bash
# Copy example file
cp .env.example .env.production

# Edit with production values
nano .env.production

# Validate
npm run validate-env:production
```

## Validation

### Automatic Validation

The application validates environment variables on startup:

```typescript
import { validateEnvOrExit } from './scripts/env/validate-env';

validateEnvOrExit();
```

### Manual Validation

```bash
# Validate current environment
npm run validate-env

# Validate specific environment
npm run validate-env:staging
npm run validate-env:production
```

## Environment-Specific Configurations

### Feature Flags

Some features are enabled/disabled based on environment:

```typescript
const isDevelopment = import.meta.env.VITE_APP_ENV === 'development';
const isProduction = import.meta.env.VITE_APP_ENV === 'production';

if (isDevelopment) {
  // Enable debug features
}

if (isProduction) {
  // Disable debug features
  // Enable error tracking
}
```

### API Endpoints

Different environments may use different API endpoints:

```typescript
const API_BASE_URL = import.meta.env.VITE_APP_ENV === 'production'
  ? 'https://api.wardah.sa'
  : 'https://api-staging.wardah.sa';
```

## Security Considerations

### Development

- ✅ Can use local/test credentials
- ✅ Debug information visible
- ⚠️ Don't commit `.env.development` with real credentials

### Staging

- ✅ Use staging credentials
- ✅ Error tracking enabled
- ⚠️ Use test data only
- ⚠️ Don't expose staging credentials

### Production

- ✅ Use production credentials only
- ✅ All security features enabled
- ✅ Error tracking required
- ✅ Encryption required
- ❌ Never commit production credentials

## Best Practices

### Do's

- ✅ Use `.env.example` as template
- ✅ Validate environment on startup
- ✅ Use different projects for each environment
- ✅ Rotate credentials regularly
- ✅ Document environment-specific settings

### Don'ts

- ❌ Don't commit `.env` files
- ❌ Don't share credentials
- ❌ Don't use production credentials in development
- ❌ Don't hardcode environment values
- ❌ Don't skip validation

## Troubleshooting

### Validation Fails

1. Check `.env` file exists
2. Verify all required variables are set
3. Check variable names (case-sensitive)
4. Verify values are correct format
5. Run validation script for details

### Wrong Environment Detected

1. Check `VITE_APP_ENV` value
2. Verify build command uses correct env file
3. Clear build cache: `rm -rf dist .vite`
4. Rebuild: `npm run build`

## References

- Validation Script: `scripts/env/validate-env.ts`
- Example File: `.env.example`
- Vite Environment Variables: [Vite Docs](https://vitejs.dev/guide/env-and-mode.html)

