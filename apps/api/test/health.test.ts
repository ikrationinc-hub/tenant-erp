import { describe, expect, it } from "vitest";
import request from "supertest";
import { z } from "zod";
import { createApp } from "../src/app.js";

const healthResponseSchema = z.object({
  status: z.string(),
  version: z.string(),
  uptime: z.number(),
});

describe("GET /health", () => {
  it("returns 200 with status, version, and uptime", async () => {
    const app = createApp();

    const response = await request(app).get("/health");
    const body = healthResponseSchema.parse(response.body);

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
  });
});
