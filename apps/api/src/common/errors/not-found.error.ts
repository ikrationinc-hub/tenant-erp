import { AppError } from "./app-error.js";

export class NotFoundError extends AppError {
  readonly httpStatus = 404;
  readonly code = "NOT_FOUND";

  constructor(message = "Resource not found", details?: Record<string, unknown>) {
    super(message, details);
  }
}
