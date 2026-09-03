#!/usr/bin/env node
// CLAUDE.md rule 3: "SET LOCAL search_path, never SET... This lives in
// getDb(ctx) and nowhere else." Mirrors apps/api/scripts/check-search-path-
// boundary.mjs exactly, scoped to apps/worker's own boundary file
// (database/get-tenant-db.ts) - added alongside C-1's clause-promotion job,
// the worker's first code to ever touch search_path at all.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SRC_ROOT = fileURLToPath(new URL("../src", import.meta.url));
const ALLOWED_RELATIVE_PATH = join("database", "get-tenant-db.ts");
const PATTERN = "search_path";

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...walk(full));
    } else if (entry.endsWith(".ts")) {
      files.push(full);
    }
  }
  return files;
}

const violations = [];
for (const file of walk(SRC_ROOT)) {
  const relativePath = relative(SRC_ROOT, file);
  if (relativePath === ALLOWED_RELATIVE_PATH) {
    continue;
  }

  const content = readFileSync(file, "utf8");
  content.split("\n").forEach((line, index) => {
    if (line.includes(PATTERN)) {
      violations.push(`  src/${relativePath}:${index + 1}: ${line.trim()}`);
    }
  });
}

if (violations.length > 0) {
  console.error(
    `"${PATTERN}" must only appear in src/${ALLOWED_RELATIVE_PATH}. Found it in:\n${violations.join("\n")}`,
  );
  process.exit(1);
}

console.log(`OK: "${PATTERN}" only appears in src/${ALLOWED_RELATIVE_PATH}`);
