import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  REDIS_URL: z.string().min(1, "REDIS_URL is required"),

  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
  JWT_REFRESH_SECRET: z.string().min(32, "JWT_REFRESH_SECRET must be at least 32 characters"),

  S3_ENDPOINT: z.string().min(1, "S3_ENDPOINT is required"),
  S3_REGION: z.string().min(1, "S3_REGION is required"),
  S3_ACCESS_KEY_ID: z.string().min(1, "S3_ACCESS_KEY_ID is required"),
  S3_SECRET_ACCESS_KEY: z.string().min(1, "S3_SECRET_ACCESS_KEY is required"),
  S3_BUCKET: z.string().min(1, "S3_BUCKET is required"),

  RESEND_API_KEY: z.string().min(1, "RESEND_API_KEY is required"),
  MAIL_FROM_ADDRESS: z.string().email("MAIL_FROM_ADDRESS must be a valid email address"),
  MAIL_FROM_NAME: z.string().min(1, "MAIL_FROM_NAME is required"),
  APP_BASE_URL: z.string().min(1, "APP_BASE_URL is required"),

  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");

    console.error(`FATAL: invalid environment configuration.\n${issues}`);
    process.exit(1);
  }

  return parsed.data;
}

export const env = loadEnv();
