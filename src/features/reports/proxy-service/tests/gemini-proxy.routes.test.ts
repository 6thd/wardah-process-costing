/**
 * Tests for the Gemini proxy routes hardening added in the security
 * remediation pass: verifyApiKey now verifies the caller's own Supabase
 * session (via supabase.auth.getUser) instead of a static shared secret —
 * a static PROXY_AUTH_KEY grants indefinite access to anyone who reads it
 * once, while a per-user session token is scoped and expires normally.
 * The POST /generate route keeps the real Google Gemini API key
 * server-side only, forwarding the caller's request body upstream.
 */
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGetUser = vi.fn();

vi.mock('@/services/gemini-financial-service', () => ({
  geminiFinancialService: {
    fetchRealFinancialKPIs: vi.fn(),
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

// Drives requests against the local test server over a real socket via
// node:http, independent of whatever the test has done to the global
// `fetch` (which the /generate handler uses internally to call "Google").
function request(
  url: string,
  options: { method: string; headers?: Record<string, string>; body?: string }
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
    if (options.body) req.write(options.body);
    req.end();
  });
}

describe('gemini-proxy routes', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.resetModules();
    mockGetUser.mockReset();
    delete process.env.GEMINI_API_KEY;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.GEMINI_API_KEY;
  });

  it('rejects requests with no Authorization header', async () => {
    const { server, baseUrl } = await startTestServer();
    try {
      const res = await request(`${baseUrl}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
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
      const res = await request(`${baseUrl}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer forged-token' },
        body: '{}',
      });
      expect(res.status).toBe(401);
    } finally {
      server.close();
    }
  });

  it('returns 500 when GEMINI_API_KEY is not configured, even for a valid session', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    const { server, baseUrl } = await startTestServer();
    try {
      const res = await request(`${baseUrl}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer real-session-token' },
        body: '{}',
      });
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: 'Service misconfigured' });
    } finally {
      server.close();
    }
  });

  it('forwards the request body to the Google Generative Language API and relays its response', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    process.env.GEMINI_API_KEY = 'server-side-google-key';
    const upstreamJson = { candidates: [{ content: 'hello' }] };
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.resolve(upstreamJson),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { server, baseUrl } = await startTestServer();
    try {
      const res = await request(`${baseUrl}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer real-session-token' },
        body: JSON.stringify({ contents: [{ parts: [{ text: 'hi' }] }] }),
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(upstreamJson);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [calledUrl, calledInit] = fetchMock.mock.calls[0];
      expect(calledUrl).toContain('key=server-side-google-key');
      expect(calledInit.method).toBe('POST');
      expect(mockGetUser).toHaveBeenCalledWith('real-session-token');
    } finally {
      server.close();
    }
  });

  it('returns 502 when the upstream Gemini call throws', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    process.env.GEMINI_API_KEY = 'server-side-google-key';
    global.fetch = vi.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;

    const { server, baseUrl } = await startTestServer();
    try {
      const res = await request(`${baseUrl}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer real-session-token' },
        body: '{}',
      });
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: 'Upstream Gemini request failed' });
    } finally {
      server.close();
    }
  });
});
