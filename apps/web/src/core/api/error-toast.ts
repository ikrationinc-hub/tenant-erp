/**
 * Bridges TanStack Query's cache-level onError (which runs outside React,
 * so it can't call an AntD hook directly) to the AntD notification API,
 * which needs the <App/> component's context. GlobalErrorToast registers
 * the real notifier on mount; before that (or in tests that don't render
 * it) notifyError is a harmless no-op.
 */
export interface ErrorToastPayload {
  message: string;
  description?: string;
}

type Notifier = (payload: ErrorToastPayload) => void;

let notifier: Notifier | null = null;

export function registerErrorNotifier(fn: Notifier | null): void {
  notifier = fn;
}

export function notifyError(payload: ErrorToastPayload): void {
  notifier?.(payload);
}
