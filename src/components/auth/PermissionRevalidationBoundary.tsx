import { useEffect, useRef, type ReactNode } from 'react';
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

interface PermissionRevalidationBoundaryProps {
  readonly blocked: boolean;
  readonly children: ReactNode;
}

export function PermissionRevalidationBoundary({
  blocked,
  children,
}: PermissionRevalidationBoundaryProps) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!blocked) return;

    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    const blockEvent = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };

    const eventTypes = ['pointerdown', 'click', 'keydown', 'beforeinput', 'submit'] as const;
    eventTypes.forEach(type => document.addEventListener(type, blockEvent, true));
    return () => {
      eventTypes.forEach(type => document.removeEventListener(type, blockEvent, true));
    };
  }, [blocked]);

  return (
    <>
      {children}
      {blocked && createPortal(
        <div
          data-testid="permission-revalidation-blocker"
          role="status"
          aria-live="assertive"
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
