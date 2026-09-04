import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceDir = fileURLToPath(new URL("..", import.meta.url));

/** Every non-test .ts file directly under core/inventory-lots - the engine/repository code itself, not this __tests__ directory. */
function engineSourceFiles(): string[] {
  return readdirSync(sourceDir).filter((name) => name.endsWith(".ts") && !name.endsWith(".d.ts"));
}

describe("core/inventory-lots - money is never a JS number (CLAUDE.md rule 1)", () => {
  it(`grep -rn "parseFloat|Number(" apps/api/src/core/inventory-lots is clean (excluding __tests__)`, () => {
    const offenders: string[] = [];

    for (const fileName of engineSourceFiles()) {
      const source = readFileSync(`${sourceDir}${fileName}`, "utf-8");
      if (/parseFloat/.test(source) || /\bNumber\(/.test(source)) {
        offenders.push(fileName);
      }
    }

    expect(offenders).toEqual([]);
  });
});
