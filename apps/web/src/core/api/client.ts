import type { ZodType } from "zod";
import { appErrorResponseSchema, refreshResponseSchema } from "@hyperion/contracts";
import { useAppStore } from "../store/app-store";
import { ApiError } from "./api-error";
import { endpoints } from "./endpoints";

export interface ApiFetchOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
}

export interface ApiFetchConfig<T> {
  /** Parses + validates the response body. Omit for a 204 or a call you deliberately leave untyped. */
  schema?: ZodType<T>;
  /** false for endpoints callable with no session (login, refresh, invitation lookup/accept). Defaults to true. */
  auth?: boolean;
}

async function toApiError(res: Response): Promise<ApiError> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }

  const parsed = appErrorResponseSchema.safeParse(body);
  if (parsed.success) {
    const { code, message, requestId, details } = parsed.data.error;
    return new ApiError(res.status, code, message, requestId, details);
  }
  return new ApiError(res.status, "UNKNOWN_ERROR", res.statusText || "Request failed");
}

function rawFetch(path: string, options: ApiFetchOptions, withAuth: boolean): Promise<Response> {
  const { body, ...rest } = options;

  const headers = new Headers(rest.headers);
  if (body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  if (withAuth) {
    const { accessToken } = useAppStore.getState();
    if (accessToken) {
      headers.set("Authorization", `Bearer ${accessToken}`);
    }
  }

  return fetch(`${import.meta.env.VITE_API_BASE_URL}${path}`, {
    ...rest,
    headers,
    body: body !== undefined ? JSON.stringify(body) : null,
  });
}

/**
 * Concurrent 401s must not fire N refresh calls: every caller awaits the
 * SAME in-flight promise, and the slot is cleared once it settles so the
 * next 401 (later, unrelated) starts a fresh refresh.
 */
let refreshInFlight: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  refreshInFlight ??= (async () => {
    const { refreshToken } = useAppStore.getState();
    if (!refreshToken) {
      useAppStore.getState().clearAuth();
      throw new ApiError(401, "NO_REFRESH_TOKEN", "Not authenticated");
    }

    const res = await rawFetch(endpoints.refresh, { method: "POST", body: { refreshToken } }, false);
    if (!res.ok) {
      useAppStore.getState().clearAuth();
      throw await toApiError(res);
    }

    const tokens = refreshResponseSchema.parse(await res.json());
    useAppStore.getState().setTokens(tokens);
    return tokens.accessToken;
  })();

  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

/**
 * The fetch wrapper every module uses. Reads the token from the Zustand
 * store (never from a closure captured at render time - the store may have
 * rotated it since), retries exactly once on a 401 after a single-flight
 * refresh, and parses the response through the caller's contract schema so
 * a shape mismatch fails loudly instead of silently.
 */
export async function apiFetch<T = unknown>(
  path: string,
  options: ApiFetchOptions = {},
  config: ApiFetchConfig<T> = {},
): Promise<T> {
  const withAuth = config.auth ?? true;
  let res = await rawFetch(path, options, withAuth);

  if (res.status === 401 && withAuth) {
    await refreshAccessToken();
    res = await rawFetch(path, options, true);
  }

  if (!res.ok) {
    throw await toApiError(res);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const json: unknown = await res.json();
  return config.schema ? config.schema.parse(json) : (json as T);
}
