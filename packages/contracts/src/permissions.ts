import { z } from "zod";

/**
 * No endpoint exposes the requesting user's resolved permission set yet -
 * core/rbac/resolve.ts computes exactly this (permissions: Set<string>)
 * for every protected request, but only ever server-side, to gate that
 * one request. Row-action gating (FE-4) needs the same set client-side
 * for UX only (frontend rule 4 - the backend remains the actual gate on
 * every write). Forward-looking, same pattern as master-options.ts and
 * scope.ts: reconcile the URL/shape once a real endpoint exists.
 */
export const myPermissionsResponseSchema = z.object({
  permissions: z.array(z.string()),
});
export type MyPermissionsResponse = z.infer<typeof myPermissionsResponseSchema>;
