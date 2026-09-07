import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface PermissionRecoveryState {
  readonly hasAccess: boolean;
  readonly loading: boolean;
  readonly error: string | null;
  readonly identityKey?: string | null;
}

/**
 * Preserve an already-authorized subtree only after a background permission
 * read becomes unreadable. The permission hook itself still fails closed and
 * clears its grants; this hook changes presentation only, so local component
 * state can survive while interaction remains blocked.
 *
 * An identity change clears the preservation latch synchronously. Old-org or
 * old-user content must never survive behind this boundary while the new
 * identity is loading.
 */
export function usePermissionRecoveryBlock({
  hasAccess,
  loading,
  error,
  identityKey,
}: PermissionRecoveryState): boolean {
  const identityRef = useRef(identityKey);
  const lastTrustedAccessRef = useRef(false);
  const blockedRef = useRef(false);

  if (identityRef.current !== identityKey) {
    identityRef.current = identityKey;
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

function blockEvent(event: Event) {
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

interface PermissionRevalidationBoundaryProps {
  readonly blocked: boolean;
  readonly children: ReactNode;
}

export function PermissionRevalidationBoundary({
  blocked,
  children,
}: PermissionRevalidationBoundaryProps) {
  const { t } = useTranslation();

  const idRef = useRef<symbol | null>(null);
  idRef.current ??= Symbol('permission-revalidation-boundary');
  const id = idRef.current;

  const owner = useSyncExternalStore(subscribeToRegistry, getBlockerOwner, getBlockerOwner);

  useEffect(() => {
    setGuardBlocked(id, blocked);
  }, [id, blocked]);

  // Unmounting while blocked must hand the overlay to another blocked guard —
  // or tear down the input block if this was the last one holding it.
  useEffect(() => () => setGuardBlocked(id, false), [id]);

  return (
    <>
      {children}
      {blocked && owner === id && createPortal(
        <div
          data-testid="permission-revalidation-blocker"
          role="alert"
          aria-live="assertive"
          aria-busy="true"
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-background"
        >
          <div className="text-center space-y-4 p-6">
            <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
            <p className="text-muted-foreground">{t('auth.checkingPermissions')}</p>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
