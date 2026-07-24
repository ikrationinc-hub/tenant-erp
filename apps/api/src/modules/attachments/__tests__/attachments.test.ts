import "./set-real-storage-env.js";

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { createApp } from "../../../app.js";
import { closeDbPool } from "../../../config/db.js";
import { closeRedis } from "../../../config/redis.js";
import { signAccessToken } from "../../../core/auth/jwt.js";
import { assignRoleToUser, createRole, grantPermissionToRole } from "../../../core/rbac/mutations.js";
import { createTenantSchema } from "../../../core/tenant/provisioner.js";
import { closeTenantDbPool, withTenantSchema } from "../../../database/get-db.js";
import { companies, permissions, users } from "../../../database/tenant/schema.js";

const TEST_TIMEOUT_MS = 120_000;

/**
 * The standard EICAR antivirus test string (https://www.eicar.org/download-anti-malware-testfile/)
 * - not a real virus, every AV engine (including ClamAV) is specifically
 * built to flag it. Embedded in an innocuously-named file below so the
 * test proves ClamAV scanned the actual BYTES, not the filename (unlike
 * apps/web's MSW mock, which fakes detection off a filename containing
 * "infected").
 */
const EICAR_TEST_STRING = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

const attachmentRowSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  entity: z.string(),
  entityId: z.string().uuid(),
  fieldKey: z.string(),
  filename: z.string(),
  contentType: z.string(),
  size: z.number(),
  storageKey: z.string(),
  checksum: z.string(),
  scannedAt: z.string(),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
});
function asAttachment(res: { body: unknown }) {
  return attachmentRowSchema.parse(res.body);
}

const presignedUrlSchema = z.object({ url: z.string(), expiresAt: z.string() });
function asPresignedUrl(res: { body: unknown }) {
  return presignedUrlSchema.parse(res.body);
}

const paginatedAttachmentsSchema = z.object({
  items: z.array(attachmentRowSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});
function asPaginatedAttachments(res: { body: unknown }) {
  return paginatedAttachmentsSchema.parse(res.body);
}

async function findPermissionId(schemaName: string, key: string): Promise<string> {
  const [row] = await withTenantSchema(schemaName, (tx) => tx.select().from(permissions).where(eq(permissions.key, key)).limit(1));
  if (!row) {
    throw new Error(`expected permission ${key} to exist in the seeded catalogue`);
  }
  return row.id;
}

interface SeededTenant {
  schemaName: string;
  companyId: string;
  userId: string;
  accessToken: string;
}

async function seedTenant(label: string): Promise<SeededTenant> {
  const unique = randomUUID().slice(0, 8);
  const tenant = await createTenantSchema({ name: `${label} Co`, slug: `${label}-${unique}` });

  const { companyId, userId } = await withTenantSchema(tenant.schemaName, async (tx) => {
    const [company] = await tx
      .insert(companies)
      .values({ name: `${label} Co`, fiscalYearStartMonth: 1, timezone: "America/New_York", createdBy: randomUUID() })
      .returning();
    if (!company) {
      throw new Error("failed to insert company");
    }
    const [user] = await tx
      .insert(users)
      .values({ companyId: company.id, email: `${label}-${unique}@example.com`, name: `${label} Admin`, status: "active", createdBy: randomUUID() })
      .returning();
    if (!user) {
      throw new Error("failed to insert user");
    }
    return { companyId: company.id, userId: user.id };
  });

  const role = await createRole({ schemaName: tenant.schemaName, companyId, name: `${label}-role`, createdBy: userId });
  await assignRoleToUser(tenant.schemaName, companyId, userId, role.id, userId);
  for (const key of ["storage.attachment.create", "storage.attachment.read"]) {
    const permissionId = await findPermissionId(tenant.schemaName, key);
    await grantPermissionToRole(tenant.schemaName, companyId, role.id, permissionId, userId);
  }

  const { token } = await signAccessToken({ sub: userId, tenant: tenant.id, company_id: companyId, roles: [], scope: "full" });

  return { schemaName: tenant.schemaName, companyId, userId, accessToken: token };
}

/**
 * Real ClamAV (docker-compose's clamav service) and real MinIO
 * (docker-compose's minio service) - no setScanner/mocked S3 client. See
 * set-real-storage-env.ts's doc comment for why the credentials are
 * overridden before any src/ module loads.
 */
describe("modules/attachments - real ClamAV + real MinIO integration (prompt 16 item 7/8)", () => {
  afterAll(async () => {
    await closeTenantDbPool();
    await closeDbPool();
    await closeRedis();
  });

  it(
    "an infected upload (real EICAR bytes, innocuous filename) is rejected with 422 before any attachment row exists",
    async () => {
      const tenant = await seedTenant("infected");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const entityId = randomUUID();

      const res = await request(app)
        .post(`/api/v1/attachments/purchase/${entityId}/invoice`)
        .set("Authorization", authHeader)
        .attach("file", Buffer.from(EICAR_TEST_STRING, "ascii"), { filename: "invoice.pdf", contentType: "application/pdf" });

      expect(res.status).toBe(422);

      const listRes = asPaginatedAttachments(
        await request(app).get("/api/v1/attachments").query({ entity: "purchase", entityId }).set("Authorization", authHeader),
      );
      expect(listRes.items).toHaveLength(0);
      expect(listRes.total).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a clean upload is scanned, stored in MinIO, and its presigned download URL resolves to the exact uploaded bytes",
    async () => {
      const tenant = await seedTenant("clean");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const entityId = randomUUID();
      const fileContent = Buffer.from(`Hyperion test invoice ${randomUUID()}`, "utf8");

      const uploadRes = await request(app)
        .post(`/api/v1/attachments/purchase/${entityId}/invoice`)
        .set("Authorization", authHeader)
        .attach("file", fileContent, { filename: "real-invoice.pdf", contentType: "application/pdf" });

      expect(uploadRes.status).toBe(201);
      const attachment = asAttachment(uploadRes);
      expect(attachment.entity).toBe("purchase");
      expect(attachment.entityId).toBe(entityId);
      expect(attachment.fieldKey).toBe("invoice");
      expect(attachment.filename).toBe("real-invoice.pdf");
      expect(attachment.size).toBe(fileContent.length);
      expect(attachment.scannedAt).toBeTruthy();

      const downloadRes = await request(app)
        .get(`/api/v1/attachments/${attachment.id}/download-url`)
        .set("Authorization", authHeader);
      expect(downloadRes.status).toBe(200);
      const presigned = asPresignedUrl(downloadRes);

      // Not a redirect - a real presigned MinIO GET URL apps/web opens itself.
      const fetched = await fetch(presigned.url);
      expect(fetched.status).toBe(200);
      const fetchedBytes = Buffer.from(await fetched.arrayBuffer());
      expect(fetchedBytes.equals(fileContent)).toBe(true);

      const listRes = asPaginatedAttachments(
        await request(app).get("/api/v1/attachments").query({ entity: "purchase", entityId }).set("Authorization", authHeader),
      );
      expect(listRes.items).toHaveLength(1);
      expect(listRes.items[0]?.id).toBe(attachment.id);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "an unrecognized content type is rejected outright - the allowlist (task item 4) still holds",
    async () => {
      const tenant = await seedTenant("disallowed-type");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const entityId = randomUUID();

      const res = await request(app)
        .post(`/api/v1/attachments/purchase/${entityId}/invoice`)
        .set("Authorization", authHeader)
        .attach("file", Buffer.from("#!/bin/sh\necho hi\n", "utf8"), { filename: "script.sh", contentType: "application/x-sh" });

      expect(res.status).toBe(422);
    },
    TEST_TIMEOUT_MS,
  );
});
