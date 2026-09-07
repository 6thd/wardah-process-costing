import { useEffect, useRef, type ReactNode, type SyntheticEvent } from 'react';
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
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!blocked) return;

    const active = document.activeElement;
    if (active instanceof HTMLElement && rootRef.current?.contains(active)) {
      active.blur();
    }
  }, [blocked]);

  const blockEvent = (event: SyntheticEvent) => {
    if (!blocked) return;
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <div
      ref={rootRef}
      className={blocked ? 'relative' : 'contents'}
      onPointerDownCapture={blockEvent}
      onClickCapture={blockEvent}
      onKeyDownCapture={blockEvent}
      onBeforeInputCapture={blockEvent}
      onSubmitCapture={blockEvent}
    >
      {children}
      {blocked && (
        <div
          data-testid="permission-revalidation-blocker"
          role="status"
          aria-live="assertive"
          className="absolute inset-0 z-50 flex min-h-[12rem] items-center justify-center bg-background"
        >
          <div className="text-center space-y-4 p-6">
            <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
            <p className="text-muted-foreground">{t('auth.checkingPermissions')}</p>
          </div>
        </div>
      )}
    </div>
  );
}
