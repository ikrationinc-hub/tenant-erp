import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  /**
   * A separate, deliberately less-privileged role from DATABASE_URL's -
   * every normal business query (get-db.ts's tenant pool) connects as this
   * role, never the superuser migrations/provisioning use. This is what
   * makes REVOKE UPDATE/DELETE on audit_logs (core/audit) mean anything: a
   * superuser bypasses every ACL check, so restricting "the application DB
   * role" requires the application to not BE a superuser in the first
   * place. See docs/adr/0007-numbering-and-audit.md.
   */
  DATABASE_APP_URL: z.string().min(1, "DATABASE_APP_URL is required"),

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
