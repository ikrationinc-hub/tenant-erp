/** Typed mirror of apps/api's AppError -> ErrorResponseBody shape (common/middleware/error-handler.ts). Same shape apps/web's ApiError mirrors - these are two separate apps, not a shared runtime, so it's duplicated rather than imported. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
