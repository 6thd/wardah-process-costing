/**
 * Tests for the fail-closed production guard added to the proxy-service
 * config loader: dev-only defaults must never silently populate a
 * production environment that is missing a required secret.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('dotenv', () => ({
  config: vi.fn(),
}));

const ENV_KEYS = ['NODE_ENV', 'WARDAH_API_ENDPOINT', 'WARDAH_API_KEY', 'JWT_SECRET', 'PROXY_AUTH_KEY'] as const;
let savedEnv: Record<string, string | undefined>;

describe('proxy-service config', () => {
  beforeEach(() => {
    savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    for (const key of ENV_KEYS) delete process.env[key];
    vi.resetModules();
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  it('fills in dev defaults when required vars are missing outside production', async () => {
    process.env.NODE_ENV = 'development';
    const { environment } = await import('../config');

    expect(environment.wardah.apiKey).toBe('dev_key');
    expect(process.env.JWT_SECRET).toBe('dev_secret');
    expect(process.env.PROXY_AUTH_KEY).toBe('dev_proxy_key');
  });

  it('throws instead of defaulting when required vars are missing in production', async () => {
    process.env.NODE_ENV = 'production';

    await expect(import('../config')).rejects.toThrow(
      /Missing required production environment variable/
    );
    expect(process.env.JWT_SECRET).toBeUndefined();
  });

  it('does not throw in production when all required vars are explicitly set', async () => {
    process.env.NODE_ENV = 'production';
    process.env.WARDAH_API_ENDPOINT = 'https://wardah.example.com';
    process.env.WARDAH_API_KEY = 'real-api-key';
    process.env.JWT_SECRET = 'real-jwt-secret';
    process.env.PROXY_AUTH_KEY = 'real-proxy-key';

    const { environment } = await import('../config');

    expect(environment.nodeEnv).toBe('production');
    expect(environment.wardah.apiKey).toBe('real-api-key');
  });
});
