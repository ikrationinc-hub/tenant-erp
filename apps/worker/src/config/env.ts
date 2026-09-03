import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  // C-1 (docs/CONTRACT-MODULE-BUILD.md): the clause-promotion scheduled job
  // is the worker's first DB-touching job - same two roles apps/api uses
  // (DATABASE_URL for platform-schema reads, DATABASE_APP_URL for
  // tenant-scoped transactions via the non-superuser hyperion_app role).
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DATABASE_APP_URL: z.string().min(1, "DATABASE_APP_URL is required"),
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
