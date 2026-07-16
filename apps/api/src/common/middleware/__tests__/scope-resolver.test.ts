import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { db } from "../../../config/db.js";
import { tenants } from "../../../database/platform/schema.js";
import { getTenantScope, runWithRequestContext } from "../../context/request-context.js";
import { errorHandler } from "../error-handler.js";
import { scopeResolverMiddleware } from "../scope-resolver.js";

const probeResponseSchema = z.object({
  scope: z
    .object({
      tenantId: z.string(),
      tenantSchema: z.string(),
      companyId: z.string(),
      branchId: z.string().optional(),
    })
    .nullable(),
});

function encodeStubToken(claims: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(claims)).toString("base64url");
}

function buildTestApp(): express.Express {
  const app = express();
  app.use((_req, _res, next) => {
    runWithRequestContext({ requestId: randomUUID() }, () => next());
  });
  app.use(scopeResolverMiddleware);
  app.get("/probe", (_req, res) => {
    res.json({ scope: getTenantScope() ?? null });
  });
  app.use(errorHandler);
  return app;
}

describe("scopeResolverMiddleware", () => {
  it("resolves tenant scope from a valid bearer token, from the token only", async () => {
    const unique = randomUUID().slice(0, 8);
    const [tenant] = await db
      .insert(tenants)
      .values({
        name: "Scope Test Co",
        slug: `scope-test-${unique}`,
        schemaName: `tenant_scope_test_${unique}`,
        status: "active",
      })
      .returning();
    if (!tenant) {
      throw new Error("setup failed: tenant insert returned no row");
    }

    const companyId = randomUUID();
    const app = buildTestApp();

    const response = await request(app)
      .get("/probe")
      .set("Authorization", `Bearer ${encodeStubToken({ tenantId: tenant.id, companyId })}`);

    expect(response.status).toBe(200);
    const body = probeResponseSchema.parse(response.body);
    expect(body.scope).toMatchObject({
      tenantId: tenant.id,
      tenantSchema: tenant.schemaName,
      companyId,
    });
  });

  it("rejects a request with no bearer token", async () => {
    const app = buildTestApp();
    const response = await request(app).get("/probe");
    expect(response.status).toBe(401);
  });

  it("ignores tenant hints from headers/query and rejects an unknown tenantId", async () => {
    const app = buildTestApp();
    const response = await request(app)
      .get("/probe?tenantId=should-be-ignored")
      .set("X-Tenant-Id", "should-also-be-ignored")
      .set(
        "Authorization",
        `Bearer ${encodeStubToken({ tenantId: randomUUID(), companyId: randomUUID() })}`,
      );

    expect(response.status).toBe(401);
  });

  it("rejects a suspended tenant", async () => {
    const unique = randomUUID().slice(0, 8);
    const [tenant] = await db
      .insert(tenants)
      .values({
        name: "Suspended Co",
        slug: `suspended-${unique}`,
        schemaName: `tenant_suspended_${unique}`,
        status: "suspended",
      })
      .returning();
    if (!tenant) {
      throw new Error("setup failed: tenant insert returned no row");
    }

    const app = buildTestApp();
    const response = await request(app)
      .get("/probe")
      .set(
        "Authorization",
        `Bearer ${encodeStubToken({ tenantId: tenant.id, companyId: randomUUID() })}`,
      );

    expect(response.status).toBe(401);
  });
});
