import { AppError } from "./app-error.js";

export class ConflictError extends AppError {
  readonly httpStatus = 409;
  readonly code = "CONFLICT";

  constructor(message = "Conflict", details?: Record<string, unknown>) {
    super(message, details);
  }
}
