/**
 * Tests for verifyApiKey: it verifies the caller's own Supabase session
 * (via supabase.auth.getUser) instead of a static shared secret — a static
 * PROXY_AUTH_KEY grants indefinite access to anyone who reads it once,
 * while a per-user session token is scoped and expires normally.
 *
 * (The POST /generate Gemini content-generation route that used to live in
 * this router was removed — this Express service has no confirmed
 * production deployment, so the route pointed at an endpoint nothing could
 * reach. Gemini generation is being redesigned as a Supabase Edge Function
 * instead. verifyApiKey itself still gates the other routes below, so it's
 * exercised here via /kpis.)
 */
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetUser = vi.fn();
const mockFetchRealFinancialKPIs = vi.fn();

vi.mock('@/services/gemini-financial-service', () => ({
  geminiFinancialService: {
    fetchRealFinancialKPIs: (...args: unknown[]) => mockFetchRealFinancialKPIs(...args),
    fetchMonthlyFinancialData: vi.fn(),
    formatForGeminiDashboard: vi.fn(),
    calculateBreakEvenAnalysis: vi.fn(),
    analyzeProfitLoss: vi.fn(),
  },
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getUser: (...args: unknown[]) => mockGetUser(...args) } },
  getEffectiveTenantId: vi.fn(),
}));

async function startTestServer() {
  const { default: geminiProxyRoutes } = await import('../routes/gemini-proxy.routes');
  const app = express();
  app.use(express.json());
  app.use('/api/wardah', geminiProxyRoutes);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const port = (server.address() as AddressInfo).port;
  return { server, baseUrl: `http://127.0.0.1:${port}/api/wardah` };
}

function request(
  url: string,
  options: { method: string; headers?: Record<string, string> }
): Promise<{ status: number; json: () => Promise<any> }> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: options.method, headers: options.headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const bodyText = Buffer.concat(chunks).toString('utf8');
        resolve({
          status: res.statusCode ?? 0,
          json: async () => JSON.parse(bodyText),
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

describe('gemini-proxy routes: verifyApiKey', () => {
  beforeEach(() => {
    vi.resetModules();
    mockGetUser.mockReset();
    mockFetchRealFinancialKPIs.mockReset();
  });

  it('rejects requests with no Authorization header', async () => {
    const { server, baseUrl } = await startTestServer();
    try {
      const res = await request(`${baseUrl}/kpis`, { method: 'GET' });
      expect(res.status).toBe(401);
      expect(mockGetUser).not.toHaveBeenCalled();
    } finally {
      server.close();
    }
  });

  it('rejects a Bearer token that does not resolve to a real Supabase user', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'invalid token' } });
    const { server, baseUrl } = await startTestServer();
    try {
      const res = await request(`${baseUrl}/kpis`, {
        method: 'GET',
        headers: { Authorization: 'Bearer forged-token' },
      });
      expect(res.status).toBe(401);
    } finally {
      server.close();
    }
  });

  it('calls through to the route handler for a Bearer token that resolves to a real user', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    mockFetchRealFinancialKPIs.mockResolvedValue({ totalSales: 100 });
    const { server, baseUrl } = await startTestServer();
    try {
      const res = await request(`${baseUrl}/kpis`, {
        method: 'GET',
        headers: { Authorization: 'Bearer real-session-token' },
      });
      expect(res.status).toBe(200);
      expect((await res.json()).data).toEqual({ totalSales: 100 });
      expect(mockGetUser).toHaveBeenCalledWith('real-session-token');
    } finally {
      server.close();
    }
  });
});
