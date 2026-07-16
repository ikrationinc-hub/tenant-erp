import { AppError } from "./app-error.js";

export class UnauthorizedError extends AppError {
  readonly httpStatus = 401;
  readonly code = "UNAUTHORIZED";

  constructor(message = "Unauthorized", details?: Record<string, unknown>) {
    super(message, details);
  }
}
