import { AppError } from "./app-error.js";

export class ForbiddenError extends AppError {
  readonly httpStatus = 403;
  readonly code = "FORBIDDEN";

  constructor(message = "Forbidden", details?: Record<string, unknown>) {
    super(message, details);
  }
}
