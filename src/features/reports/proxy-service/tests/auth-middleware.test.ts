/**
 * Tests for server.ts's authMiddleware hardening: it used to accept any
 * Bearer-shaped header without verifying it, per a comment that promised
 * verification that never happened. It now checks the token against
 * Supabase via auth.getUser() and rejects anything that doesn't resolve
 * to a real session.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetUser = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getUser: (...args: unknown[]) => mockGetUser(...args) } },
}));

function mockRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe('proxy-service authMiddleware', () => {
  beforeEach(() => {
    mockGetUser.mockReset();
  });

  it('rejects a request with no Authorization header', async () => {
    const { authMiddleware } = await import('../auth-middleware');
    const req: any = { headers: {} };
    const res = mockRes();
    const next = vi.fn();

    await authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it('rejects a header that is not a Bearer token', async () => {
    const { authMiddleware } = await import('../auth-middleware');
    const req: any = { headers: { authorization: 'Basic dXNlcjpwYXNz' } };
    const res = mockRes();
    const next = vi.fn();

    await authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a Bearer token that Supabase does not recognize', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'invalid' } });
    const { authMiddleware } = await import('../auth-middleware');
    const req: any = { headers: { authorization: 'Bearer forged-token' } };
    const res = mockRes();
    const next = vi.fn();

    await authMiddleware(req, res, next);

    expect(mockGetUser).toHaveBeenCalledWith('forged-token');
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() for a Bearer token that resolves to a real user', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    const { authMiddleware } = await import('../auth-middleware');
    const req: any = { headers: { authorization: 'Bearer real-session-token' } };
    const res = mockRes();
    const next = vi.fn();

    await authMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
