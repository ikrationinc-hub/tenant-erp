import pino, { type LoggerOptions } from "pino";
import { env } from "./env.js";

const options: LoggerOptions = {
  level: env.LOG_LEVEL,
  base: { service: "worker" },
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
