import { AppError } from "./app-error.js";

export class ValidationError extends AppError {
  readonly httpStatus = 422;
  readonly code = "VALIDATION_ERROR";

  constructor(message = "Validation failed", details?: Record<string, unknown>) {
    super(message, details);
  }
}
