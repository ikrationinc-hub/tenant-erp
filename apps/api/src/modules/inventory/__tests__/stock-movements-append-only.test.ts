import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositorySourcePath = fileURLToPath(new URL("../stock-movements.repository.ts", import.meta.url));

describe("modules/inventory - stock_movements is an append-only ledger (CLAUDE.md §6.7)", () => {
  it("the repository has no tx.update(stockMovements) or tx.delete(stockMovements) path - a correction is a new offsetting row, never an edit", () => {
    const source = readFileSync(repositorySourcePath, "utf-8");
    expect(source).not.toMatch(/\.update\(\s*stockMovements\s*\)/);
    expect(source).not.toMatch(/\.delete\(\s*stockMovements\s*\)/);
  });
});
