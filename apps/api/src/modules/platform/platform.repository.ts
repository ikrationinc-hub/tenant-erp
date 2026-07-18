import { eq } from "drizzle-orm";
import { db } from "../../config/db.js";
import { platformAdmins } from "../../database/platform/schema.js";

export type PlatformAdminRow = typeof platformAdmins.$inferSelect;

/** Only the repository layer touches SQL (rule 5) - service/controller never import `db`. */

export async function findPlatformAdminByEmail(email: string): Promise<PlatformAdminRow | undefined> {
  const [admin] = await db.select().from(platformAdmins).where(eq(platformAdmins.email, email)).limit(1);
  return admin;
}

export interface InsertPlatformAdminInput {
  email: string;
  passwordHash: string;
  name: string;
}

/**
 * Not exposed over HTTP - platform admins are "you/Knackroot" (docs/
 * Hyperion-ERP-Backend-Plan-v2.md), manually provisioned, not a self-
 * service signup. Exists for tests and a future seed script.
 */
export async function insertPlatformAdmin(input: InsertPlatformAdminInput): Promise<PlatformAdminRow> {
  const [admin] = await db.insert(platformAdmins).values(input).returning();
  if (!admin) {
    throw new Error("failed to insert platform admin");
  }
  return admin;
}
