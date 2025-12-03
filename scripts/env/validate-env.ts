/**
 * Environment Variables Validation Script
 * 
 * This script validates that all required environment variables are set
 * and have valid values before starting the application.
 */

import { z } from 'zod';

// Environment schema
const envSchema = z.object({
  // Supabase Configuration
  VITE_SUPABASE_URL: z.string().url('Invalid Supabase URL'),
  VITE_SUPABASE_ANON_KEY: z.string().min(1, 'Supabase anon key is required'),
  
  // Optional: Service Role Key (server-side only)
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  
  // Application Configuration
  VITE_APP_ENV: z.enum(['development', 'staging', 'production'], {
    errorMap: () => ({ message: 'APP_ENV must be development, staging, or production' })
  }).default('development'),
  
  // Optional: Sentry Configuration
  VITE_SENTRY_DSN: z.string().url().optional(),
  
  // Optional: Analytics
  VITE_GA_ID: z.string().optional(),
  
  // Optional: Encryption Key
  VITE_ENCRYPTION_KEY: z.string().min(32, 'Encryption key must be at least 32 characters').optional(),
});

type Env = z.infer<typeof envSchema>;

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  env: Partial<Env>;
}

/**
 * Validate environment variables
 */
export function validateEnv(): ValidationResult {
  const result: ValidationResult = {
    valid: true,
    errors: [],
    warnings: [],
    env: {},
  };

  try {
    // Get all environment variables
    const envVars = {
      VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
      VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: import.meta.env.SUPABASE_SERVICE_ROLE_KEY,
      VITE_APP_ENV: import.meta.env.VITE_APP_ENV || 'development',
      VITE_SENTRY_DSN: import.meta.env.VITE_SENTRY_DSN,
      VITE_GA_ID: import.meta.env.VITE_GA_ID,
      VITE_ENCRYPTION_KEY: import.meta.env.VITE_ENCRYPTION_KEY,
    };

    // Validate using schema
    const validated = envSchema.parse(envVars);
    result.env = validated;

    // Additional validations
    if (validated.VITE_APP_ENV === 'production') {
      if (!validated.VITE_SENTRY_DSN) {
        result.warnings.push('Sentry DSN not set - error tracking disabled in production');
      }
      
      if (!validated.VITE_ENCRYPTION_KEY) {
        result.warnings.push('Encryption key not set - sensitive data may not be encrypted');
      }
    }

    // Check for common misconfigurations
    if (validated.VITE_SUPABASE_URL.includes('localhost') && validated.VITE_APP_ENV === 'production') {
      result.warnings.push('Using localhost Supabase URL in production environment');
    }

  } catch (error) {
    result.valid = false;
    
    if (error instanceof z.ZodError) {
      result.errors = error.errors.map(err => {
        const path = err.path.join('.');
        return `${path}: ${err.message}`;
      });
    } else {
      result.errors.push(`Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  return result;
}

/**
 * Print validation results
 */
export function printValidationResults(result: ValidationResult): void {
  console.log('\n=== Environment Validation ===\n');

  if (result.valid) {
    console.log('✅ Environment variables are valid\n');
    
    if (result.warnings.length > 0) {
      console.log('⚠️  Warnings:');
      result.warnings.forEach(warning => {
        console.log(`   - ${warning}`);
      });
      console.log('');
    }
    
    console.log('Environment Configuration:');
    console.log(`   APP_ENV: ${result.env.VITE_APP_ENV}`);
    console.log(`   Supabase URL: ${result.env.VITE_SUPABASE_URL?.substring(0, 30)}...`);
    console.log(`   Sentry: ${result.env.VITE_SENTRY_DSN ? '✅ Configured' : '❌ Not configured'}`);
    console.log(`   Analytics: ${result.env.VITE_GA_ID ? '✅ Configured' : '❌ Not configured'}`);
    console.log('');
  } else {
    console.log('❌ Environment validation failed!\n');
    console.log('Errors:');
    result.errors.forEach(error => {
      console.log(`   - ${error}`);
    });
    console.log('');
    console.log('Please check your .env file and ensure all required variables are set.');
    console.log('See .env.example for reference.\n');
  }
}

/**
 * Validate and exit if invalid
 */
export function validateEnvOrExit(): void {
  const result = validateEnv();
  printValidationResults(result);
  
  if (!result.valid) {
    process.exit(1);
  }
}

// Run validation if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  validateEnvOrExit();
}

export default validateEnv;

