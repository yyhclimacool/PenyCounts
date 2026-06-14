import * as React from 'react';

/**
 * React's <ViewTransition> ships under different names across canary builds
 * (`ViewTransition` vs `unstable_ViewTransition`). Resolve it defensively so the
 * app degrades gracefully (renders children as-is) if the API is unavailable.
 */
const ViewTransition: React.ComponentType<Record<string, unknown>> | undefined =
  (React as unknown as Record<string, unknown>).unstable_ViewTransition as
    | React.ComponentType<Record<string, unknown>>
    | undefined ??
  ((React as unknown as Record<string, unknown>).ViewTransition as
    | React.ComponentType<Record<string, unknown>>
    | undefined);

/**
 * Wrap a page/section so it slides directionally during type-keyed navigation
 * and gracefully cross-fades otherwise. Falls back to a plain fragment when the
 * View Transition API isn't present.
 */
export function DirectionalTransition({ children }: { children: React.ReactNode }) {
  if (!ViewTransition) return <>{children}</>;
  return (
    <ViewTransition
      enter={{ 'nav-forward': 'nav-forward', 'nav-back': 'nav-back', default: 'fade-in' }}
      exit={{ 'nav-forward': 'nav-forward', 'nav-back': 'nav-back', default: 'fade-out' }}
      default="none"
    >
      {children}
    </ViewTransition>
  );
}

export const ViewTransitionAvailable = Boolean(ViewTransition);
