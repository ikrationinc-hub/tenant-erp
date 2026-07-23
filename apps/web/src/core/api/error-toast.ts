import { ApiError } from "./api-error";

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

/**
 * Shared with query-client.ts's queryCache/mutationCache onError, and with
 * SchemaForm.tsx's onSubmit catch - a form's submit handler is a plain
 * async function, not a useMutation, so a thrown ApiError (e.g. BE-7's 403
 * "cannot hold a role with an approval permission") would otherwise never
 * reach the user: `void handleSubmit(...)` discards the rejection outright.
 */
export function toToastPayload(error: unknown): ErrorToastPayload {
  if (error instanceof ApiError) {
    return { message: error.code.replace(/_/g, " "), description: error.message };
  }
  if (error instanceof Error) {
    return { message: "Request failed", description: error.message };
  }
  return { message: "Request failed" };
}
