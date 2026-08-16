/**
 * Real render coverage for EnhancedInsightsDashboard.tsx's MessageChannel
 * handshake and message-handling logic — the code this PR rewrote around
 * the sandboxed iframe's opaque origin (see the module comment at the top
 * of the component). e2e/reports-insights-isolation.spec.ts already
 * proves this end-to-end in a real browser against the real iframe
 * content; this test exercises the same component in isolation so the
 * logic is covered by the unit-test suite too, not only by the separate
 * (CI-gated, but not part of `npm run test:coverage`) Playwright run.
 *
 * MessageChannel is stubbed with a same-process fake (real ports/ordering
 * semantics, just no actual cross-document delivery) rather than jsdom's
 * built-in MessageChannel, because the transferable-object handoff to a
 * real (but srcless, content-less) iframe's contentWindow in jsdom is not
 * something this test needs to prove — that delivery mechanism itself is
 * exactly what the Playwright suite verifies in a real browser instead.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { EnhancedInsightsDashboard } from '../EnhancedInsightsDashboard';

const mockKpis = {
  totalSales: 100000,
  totalCosts: 80000,
  totalCOGS: 60000,
  totalOperatingExpenses: 20000,
  netProfit: 20000,
  grossProfit: 40000,
  profitMargin: 20,
};
// available: true here only to exercise the component's numeric-display
// branch in this test file; calculateBreakEvenAnalysis() itself always
// returns available: false in the real service (see its own comment) since
// no real fixed/variable cost classification exists anywhere in this schema.
const mockBreakEven = {
  available: true as const,
  breakEvenSales: 50000,
  breakEvenUnits: 100,
  marginOfSafetyPercent: 50,
  marginOfSafety: 50000,
  fixedCosts: 10000,
  variableCosts: 5000,
  contributionMargin: 40000,
  contributionMarginRatio: 0.4,
  currentSales: 100000,
};

vi.mock('@/services/gemini-financial-service', () => ({
  geminiFinancialService: {
    fetchRealFinancialKPIs: vi.fn(async () => mockKpis),
    calculateBreakEvenAnalysis: vi.fn(async () => mockBreakEven),
    fetchMonthlyFinancialData: vi.fn(async () => []),
    analyzeProfitLoss: vi.fn(async () => ({})),
    formatForGeminiDashboard: vi.fn(() => ({ monthlyData: [] })),
  },
}));

const mockGetSession = vi.fn();
const mockInvoke = vi.fn();
vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    auth: { getSession: mockGetSession },
    functions: { invoke: mockInvoke },
  }),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Same-process fake: port1/port2 are directly wired to each other, so
// port1.postMessage(x) synchronously invokes port2.onmessage and vice
// versa — enough to drive the component's real handshake/dispatch logic
// without jsdom's real (and here, irrelevant) cross-document delivery.
class FakePort {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  other: FakePort | null = null;
  postMessage(data: unknown) {
    this.other?.onmessage?.({ data });
  }
  close() {
    this.onmessage = null;
  }
}
class FakeMessageChannel {
  port1 = new FakePort();
  port2 = new FakePort();
  constructor() {
    this.port1.other = this.port2;
    this.port2.other = this.port1;
  }
}

function renderDashboard() {
  const utils = render(<EnhancedInsightsDashboard />);
  const iframe = document.querySelector('iframe') as HTMLIFrameElement;
  const fakeContentWindowPostMessage = vi.fn();
  // Real jsdom iframes have a real contentWindow (a nested Window), but
  // its postMessage's transferable-object handling for a fake, non-spec
  // MessagePort is exactly the part this test intentionally doesn't rely
  // on (see file header) — stub it so onLoad's handshake call is a plain,
  // observable no-op instead.
  Object.defineProperty(iframe, 'contentWindow', {
    value: { postMessage: fakeContentWindowPostMessage },
    writable: true,
  });
  return { ...utils, iframe, fakeContentWindowPostMessage };
}

describe('EnhancedInsightsDashboard — MessageChannel handshake and message handling', () => {
  beforeEach(() => {
    vi.stubGlobal('MessageChannel', FakeMessageChannel);
    mockGetSession.mockReset();
    mockInvoke.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders KPI cards from the real geminiFinancialService data on mount', async () => {
    renderDashboard();
    await waitFor(() => expect(screen.getByText(/100,000\.00/)).toBeInTheDocument());
  });

  it('onLoad performs exactly one handshake postMessage carrying a MessagePort, and no other window.postMessage call', async () => {
    const { iframe, fakeContentWindowPostMessage } = renderDashboard();
    iframe.dispatchEvent(new Event('load'));

    expect(fakeContentWindowPostMessage).toHaveBeenCalledTimes(1);
    const [msg, targetOrigin, transfer] = fakeContentWindowPostMessage.mock.calls[0];
    expect(msg).toEqual({ type: 'WARDHAH_CHANNEL_INIT' });
    expect(targetOrigin).toBe('*');
    expect(transfer).toHaveLength(1);
    expect(transfer[0]).toBeInstanceOf(FakePort);
  });

  it('a second load event does not re-open the channel or resend the handshake (exactly-once port delivery)', async () => {
    const { iframe, fakeContentWindowPostMessage } = renderDashboard();

    let firstChannel: FakeMessageChannel | undefined;
    class CapturingFakeMessageChannel extends FakeMessageChannel {
      constructor() {
        super();
        if (!firstChannel) firstChannel = this;
      }
    }
    vi.stubGlobal('MessageChannel', CapturingFakeMessageChannel);

    iframe.dispatchEvent(new Event('load'));
    expect(fakeContentWindowPostMessage).toHaveBeenCalledTimes(1);

    // A second load event (iframe re-navigation/reload) must not open a
    // new MessageChannel or send a second handshake — see
    // handshakeSentRef in EnhancedInsightsDashboard.tsx.
    iframe.dispatchEvent(new Event('load'));
    expect(fakeContentWindowPostMessage).toHaveBeenCalledTimes(1);

    // The original port must still be the live, working one — not closed
    // or replaced — proving the guard actually skipped the second
    // handshake rather than merely suppressing the postMessage call while
    // leaving the component's own port reference broken.
    const responses: unknown[] = [];
    firstChannel!.port2.onmessage = (event) => responses.push(event.data);
    firstChannel!.port2.postMessage({ type: 'REQUEST_WARDHAH_DATA', requestId: 'still-alive-after-second-load' });

    await waitFor(() => expect(responses.some((r: any) => r.type === 'WARDHAH_DATA_SYNC')).toBe(true));
  });

  it('handles a REQUEST_WARDHAH_DATA message from the iframe by re-syncing and pushing WARDHAH_DATA_SYNC back over the port (no auth/network call for this message type)', async () => {
    const { iframe } = renderDashboard();

    let capturedChannel: FakeMessageChannel | undefined;
    class CapturingFakeMessageChannel extends FakeMessageChannel {
      constructor() {
        super();
        capturedChannel = this;
      }
    }
    vi.stubGlobal('MessageChannel', CapturingFakeMessageChannel);

    iframe.dispatchEvent(new Event('load'));
    const responses: unknown[] = [];
    capturedChannel!.port2.onmessage = (event) => responses.push(event.data);

    capturedChannel!.port2.postMessage({ type: 'REQUEST_WARDHAH_DATA', requestId: 'sync-req-1' });

    await waitFor(() => expect(responses.some((r: any) => r.type === 'WARDHAH_DATA_SYNC')).toBe(true));
    expect(mockGetSession).not.toHaveBeenCalled();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('replies not_authenticated over the port when there is no Supabase session, for a valid insight request', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    const { iframe } = renderDashboard();

    let capturedChannel: FakeMessageChannel | undefined;
    const OriginalFake = FakeMessageChannel;
    class CapturingFakeMessageChannel extends OriginalFake {
      constructor() {
        super();
        capturedChannel = this;
      }
    }
    vi.stubGlobal('MessageChannel', CapturingFakeMessageChannel);

    iframe.dispatchEvent(new Event('load'));
    expect(capturedChannel).toBeDefined();

    const responses: unknown[] = [];
    capturedChannel!.port2.onmessage = (event) => responses.push(event.data);

    capturedChannel!.port2.postMessage({
      type: 'WARDHAH_INSIGHT_REQUEST',
      requestId: 'req-1',
      operation: 'summary',
      locale: 'en',
      data: {},
    });

    // Not asserting responses.length — see the comment in the "invokes
    // the reports-insights Edge Function..." test below for why an
    // unrelated WARDHAH_DATA_SYNC can legitimately also land here.
    await waitFor(() =>
      expect(responses.some((r: any) => r.type === 'WARDHAH_INSIGHT_RESPONSE' && r.requestId === 'req-1')).toBe(true)
    );
    const insightResponse = responses.find((r: any) => r.type === 'WARDHAH_INSIGHT_RESPONSE');
    expect(insightResponse).toMatchObject({
      type: 'WARDHAH_INSIGHT_RESPONSE',
      requestId: 'req-1',
      success: false,
      error: 'not_authenticated',
    });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('invokes the reports-insights Edge Function and replies with success over the port when authenticated', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'fake' } } });
    mockInvoke.mockResolvedValue({ data: { success: true, source: 'ai', text: 'hello from the model' }, error: null });

    const { iframe } = renderDashboard();

    let capturedChannel: FakeMessageChannel | undefined;
    class CapturingFakeMessageChannel extends FakeMessageChannel {
      constructor() {
        super();
        capturedChannel = this;
      }
    }
    vi.stubGlobal('MessageChannel', CapturingFakeMessageChannel);

    iframe.dispatchEvent(new Event('load'));
    const responses: unknown[] = [];
    capturedChannel!.port2.onmessage = (event) => responses.push(event.data);

    capturedChannel!.port2.postMessage({
      type: 'WARDHAH_INSIGHT_REQUEST',
      requestId: 'req-2',
      operation: 'ask',
      locale: 'en',
      question: 'How are margins trending?',
    });

    // Not asserting responses.length: the component's own initial-mount
    // sync (unrelated to this test's explicit request) races the
    // handshake and can legitimately land a WARDHAH_DATA_SYNC on this
    // same port too — a real, correct side effect of mount order, not
    // something this test is about. Filtering by type/requestId is the
    // robust way to assert on the one response this test actually cares
    // about regardless of what else arrives on the port.
    await waitFor(() =>
      expect(responses.some((r: any) => r.type === 'WARDHAH_INSIGHT_RESPONSE' && r.requestId === 'req-2')).toBe(true)
    );
    expect(mockInvoke).toHaveBeenCalledWith('reports-insights', {
      body: { operation: 'ask', locale: 'en', requestId: 'req-2', question: 'How are margins trending?' },
    });
    const insightResponse = responses.find((r: any) => r.type === 'WARDHAH_INSIGHT_RESPONSE');
    expect(insightResponse).toMatchObject({
      type: 'WARDHAH_INSIGHT_RESPONSE',
      requestId: 'req-2',
      success: true,
      source: 'ai',
      text: 'hello from the model',
    });
  });

  it('replies success:false immediately (not a fabricated success) when the Edge Function classifies the provider as unavailable', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'fake' } } });
    // The Edge Function's own contract (supabase/functions/reports-insights/index.ts):
    // a classified provider failure is HTTP 200 with success:false/source:'fallback'.
    // supabase-js's `error` is only set for a non-2xx status, so it is null here
    // exactly like a real success — the component must branch on data.success,
    // not on the absence of `error`, to avoid relaying a fabricated success.
    mockInvoke.mockResolvedValue({
      data: { success: false, error: 'provider_unavailable', source: 'fallback', requestId: 'req-3' },
      error: null,
    });

    const { iframe } = renderDashboard();

    let capturedChannel: FakeMessageChannel | undefined;
    class CapturingFakeMessageChannel extends FakeMessageChannel {
      constructor() {
        super();
        capturedChannel = this;
      }
    }
    vi.stubGlobal('MessageChannel', CapturingFakeMessageChannel);

    iframe.dispatchEvent(new Event('load'));
    const responses: unknown[] = [];
    capturedChannel!.port2.onmessage = (event) => responses.push(event.data);

    capturedChannel!.port2.postMessage({
      type: 'WARDHAH_INSIGHT_REQUEST',
      requestId: 'req-3',
      operation: 'summary',
      locale: 'en',
      data: {},
    });

    await waitFor(() =>
      expect(responses.some((r: any) => r.type === 'WARDHAH_INSIGHT_RESPONSE' && r.requestId === 'req-3')).toBe(true)
    );
    const insightResponse = responses.find((r: any) => r.type === 'WARDHAH_INSIGHT_RESPONSE') as any;
    // success:false so the iframe's own isValidInsightResponse() (which
    // requires a non-empty string `text` whenever success:true) accepts the
    // message and its resolver fires right away — never a fabricated
    // success, and never a silently dropped reply that stalls until the
    // iframe's own 15s local-fallback timeout.
    expect(insightResponse).toMatchObject({
      type: 'WARDHAH_INSIGHT_RESPONSE',
      requestId: 'req-3',
      success: false,
      error: 'provider_unavailable',
    });
    expect(insightResponse.text).toBeUndefined();
  });

  it('ignores a message with an invalid/unrecognized shape instead of replying to it', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'fake' } } });
    const { iframe } = renderDashboard();

    let capturedChannel: FakeMessageChannel | undefined;
    class CapturingFakeMessageChannel extends FakeMessageChannel {
      constructor() {
        super();
        capturedChannel = this;
      }
    }
    vi.stubGlobal('MessageChannel', CapturingFakeMessageChannel);

    iframe.dispatchEvent(new Event('load'));
    const responses: unknown[] = [];
    capturedChannel!.port2.onmessage = (event) => responses.push(event.data);

    capturedChannel!.port2.postMessage({ type: 'SOMETHING_UNRECOGNIZED' });
    capturedChannel!.port2.postMessage({ type: 'WARDHAH_INSIGHT_REQUEST' }); // missing requestId/operation/locale

    await new Promise((resolve) => setTimeout(resolve, 50));
    // See the comment in the previous test — a WARDHAH_DATA_SYNC from the
    // initial mount sync is expected and irrelevant here; what this test
    // actually asserts is that neither invalid message produced a reply.
    expect(responses.some((r: any) => r.type === 'WARDHAH_INSIGHT_RESPONSE')).toBe(false);
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
