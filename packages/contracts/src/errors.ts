import { z } from "zod";

/** Mirrors apps/api/src/common/middleware/error-handler.ts's ErrorResponseBody. */
export const appErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});
export type AppErrorResponse = z.infer<typeof appErrorResponseSchema>;
