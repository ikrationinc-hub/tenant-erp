import pino, { type LoggerOptions } from "pino";
import { env } from "./env.js";
import { getRequestId } from "../common/context/request-context.js";

const options: LoggerOptions = {
  level: env.LOG_LEVEL,
  base: { service: "api" },
  mixin() {
    const requestId = getRequestId();
    return requestId ? { requestId } : {};
  },
  ...(env.NODE_ENV === "development"
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "HH:MM:ss.l", ignore: "pid,hostname" },
        },
      }
    : {}),
};

export const logger = pino(options);
