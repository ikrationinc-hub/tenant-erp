import { closeDbPool } from "../src/config/db.js";
import { logger } from "../src/config/logger.js";
import { hashPassword } from "../src/core/auth/password.js";
import {
  findPlatformAdminByEmail,
  insertPlatformAdmin,
} from "../src/modules/platform/platform.repository.js";

/**
 * Idempotent bootstrap: `pnpm seed:platform-admin`. Credentials come from
 * env, never hardcoded (ADM-1 task item 7) - re-running with the same
 * PLATFORM_BOOTSTRAP_ADMIN_EMAIL is a no-op if that admin already exists,
 * so this is safe to include in a deploy pipeline every time.
 */
function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required to seed the bootstrap platform admin`);
  }
  return value;
}

async function main(): Promise<void> {
  const email = requiredEnv("PLATFORM_BOOTSTRAP_ADMIN_EMAIL");
  const password = requiredEnv("PLATFORM_BOOTSTRAP_ADMIN_PASSWORD");
  const name = process.env.PLATFORM_BOOTSTRAP_ADMIN_NAME ?? "Platform Admin";

  const existing = await findPlatformAdminByEmail(email);
  if (existing) {
    console.log(`Bootstrap platform admin "${email}" already exists (id: ${existing.id}) - nothing to do.`);
    return;
  }

  const passwordHash = await hashPassword(password);
  const admin = await insertPlatformAdmin({ email, passwordHash, name });
  console.log(`Created bootstrap platform admin "${admin.email}" (id: ${admin.id}).`);
}

main()
  .catch((error: unknown) => {
    logger.error({ err: error }, "seed-platform-admin run crashed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDbPool();
  });
