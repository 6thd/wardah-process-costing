import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface PermissionRecoveryState {
  readonly hasAccess: boolean;
  readonly loading: boolean;
  readonly error: string | null;
  /**
   * What the preserved decision was granted FOR. The latch survives only while
   * this is unchanged, so it covers both the identity (user/org) and the thing
   * being guarded (the route requirement, or the module/action pair).
   */
  readonly scopeKey?: string | null;
}

/**
 * Preserve an already-authorized subtree only after a background permission
 * read becomes unreadable. The permission hook itself still fails closed and
 * clears its grants; this hook changes presentation only, so local component
 * state can survive while interaction remains blocked.
 *
 * A scope change clears the preservation latch synchronously. Two distinct
 * things must clear it, and both are folded into `scopeKey` by the caller:
 *
 * - An identity change. Old-org or old-user content must never survive behind
 *   this boundary while the new identity is loading.
 * - A change in what is being guarded. One ModuleGuard wraps a whole module
 *   whose pages carry different permission keys (`/sales/orders` needs
 *   sales.sales_orders.read, `/sales/customers` needs sales.customers.read),
 *   so a navigation during an outage would otherwise keep the latch and mount
 *   a screen whose own requirement was never satisfied.
 */
export function usePermissionRecoveryBlock({
  hasAccess,
  loading,
  error,
  scopeKey,
}: PermissionRecoveryState): boolean {
  const scopeRef = useRef(scopeKey);
  const lastTrustedAccessRef = useRef(false);
  const blockedRef = useRef(false);

  if (scopeRef.current !== scopeKey) {
    scopeRef.current = scopeKey;
    lastTrustedAccessRef.current = false;
    blockedRef.current = false;
  }

  if (!loading && !error) {
    lastTrustedAccessRef.current = hasAccess;
    blockedRef.current = false;
  } else if (error && lastTrustedAccessRef.current) {
    blockedRef.current = true;
  }

  return blockedRef.current;
}

// =====================================
// Application-scoped blocker registry
// =====================================
//
// One failed permission read latches EVERY guard mounted under it at once: the
// page's ModuleGuard plus every inline PermissionGuard/withPermission below it.
// The blocker is an application-scoped modal, so rendering it per guard stacked
// N opaque full-screen layers and installed N sets of document-level capture
// listeners for a single failure. The registry below keeps the boundary
// component per-guard (each still preserves its own subtree) while the overlay
// and the input block are shared: the first guard to latch owns them, and
// ownership transfers if that guard recovers or unmounts before the others.

/**
 * Blocked event types, capture phase, on `document`.
 *
 * React 18 attaches its listeners to the root container, which is a descendant
 * of `document.body`, so a capture listener here runs first and can stop the
 * event before any synthetic handler sees it.
 *
 * The list covers pointer, touch and mouse entry points rather than relying on
 * `pointerdown` alone to suppress its compatibility events, and covers the
 * non-keyboard paths into an input (`paste`, `drop`, `dragstart`) alongside
 * `beforeinput`.
 */
const BLOCKED_EVENT_TYPES = [
  'pointerdown',
  'mousedown',
  'touchstart',
  'click',
  'keydown',
  'keyup',
  'beforeinput',
  'paste',
  'drop',
  'dragstart',
  'submit',
] as const;

/**
 * The overlay's own DOM node. Events originating inside it are NOT blocked —
 * otherwise the blocker would suppress its own retry control and leave no way
 * out of an outage that started while the tab was already visible.
 */
let blockerNode: HTMLElement | null = null;

function blockEvent(event: Event) {
  const target = event.target;
  if (blockerNode && target instanceof Node && blockerNode.contains(target)) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}

function acquireInputBlock() {
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
  BLOCKED_EVENT_TYPES.forEach(type => document.addEventListener(type, blockEvent, true));
}

function releaseInputBlock() {
  BLOCKED_EVENT_TYPES.forEach(type => document.removeEventListener(type, blockEvent, true));
}

/** Insertion-ordered: index 0 owns the overlay and the document input block. */
const blockedGuards: symbol[] = [];
const registrySubscribers = new Set<() => void>();

function getBlockerOwner(): symbol | null {
  return blockedGuards[0] ?? null;
}

function subscribeToRegistry(onChange: () => void) {
  registrySubscribers.add(onChange);
  return () => {
    registrySubscribers.delete(onChange);
  };
}

function setGuardBlocked(id: symbol, blocked: boolean) {
  const index = blockedGuards.indexOf(id);
  if (blocked === (index !== -1)) return;

  if (blocked) {
    blockedGuards.push(id);
    if (blockedGuards.length === 1) acquireInputBlock();
  } else {
    blockedGuards.splice(index, 1);
    if (blockedGuards.length === 0) releaseInputBlock();
  }

  registrySubscribers.forEach(notify => notify());
}

// Exponential backoff, so a long outage does not turn into a request flood.
const RETRY_BASE_MS = 2_000;
const RETRY_MAX_MS = 30_000;

interface PermissionRevalidationBoundaryProps {
  readonly blocked: boolean;
  /**
   * Re-reads the permission snapshot. Without it a failure that happens while
   * the tab is already visible has no way out: the hook schedules no retry of
   * its own, and the only other re-reads in the app are `visibilitychange` and
   * an explicit refresh elsewhere.
   */
  readonly onRetry?: () => void | Promise<void>;
  readonly children: ReactNode;
}

export function PermissionRevalidationBoundary({
  blocked,
  onRetry,
  children,
}: PermissionRevalidationBoundaryProps) {
  const { t } = useTranslation();

  const idRef = useRef<symbol | null>(null);
  idRef.current ??= Symbol('permission-revalidation-boundary');
  const id = idRef.current;

  const owner = useSyncExternalStore(subscribeToRegistry, getBlockerOwner, getBlockerOwner);
  const ownsBlocker = blocked && owner === id;

  const retryRef = useRef(onRetry);
  useEffect(() => {
    retryRef.current = onRetry;
  }, [onRetry]);

  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setGuardBlocked(id, blocked);
    if (!blocked) setAttempt(0);
  }, [id, blocked]);

  // Unmounting while blocked must hand the overlay to another blocked guard —
  // or tear down the input block if this was the last one holding it.
  useEffect(() => () => setGuardBlocked(id, false), [id]);

  // Only the owner drives retries, so N latched guards do not multiply them.
  useEffect(() => {
    if (!ownsBlocker) return;

    const delay = Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS);
    const timer = setTimeout(() => {
      setAttempt(current => current + 1);
      void retryRef.current?.();
    }, delay);

    return () => clearTimeout(timer);
  }, [ownsBlocker, attempt]);

  const retryNow = useCallback(() => {
    setAttempt(0);
    void retryRef.current?.();
  }, []);

  return (
    <>
      {children}
      {ownsBlocker && createPortal(
        <div
          ref={node => { blockerNode = node; }}
          data-testid="permission-revalidation-blocker"
          role="alert"
          aria-live="assertive"
          aria-busy="true"
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-background"
        >
          <div className="text-center space-y-4 p-6">
            <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
            <p className="text-muted-foreground">{t('auth.checkingPermissions')}</p>
            <button
              type="button"
              data-testid="permission-revalidation-retry"
              onClick={retryNow}
              className="text-sm underline text-primary hover:no-underline"
            >
              {t('auth.retryPermissionCheck')}
            </button>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
