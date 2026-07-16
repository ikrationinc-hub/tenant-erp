import express, { type Express } from "express";
import helmet from "helmet";
import cors from "cors";
import { rateLimit } from "express-rate-limit";
import { requestContextMiddleware } from "./common/middleware/request-context.middleware.js";
import { errorHandler } from "./common/middleware/error-handler.js";
import { healthRouter } from "./modules/health/health.routes.js";

export function createApp(): Express {
  const app = express();

  app.use(requestContextMiddleware);
  app.use(helmet());
  app.use(cors());
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 300,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );
  app.use(express.json());

  app.use(healthRouter);

  app.use(errorHandler);

  return app;
}
