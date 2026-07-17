#!/usr/bin/env node
// CLAUDE.md: "Scatter if (user.role === 'admin') - that's the RBAC
// middleware's job." This script fails the build if an inline role-name
// string comparison appears anywhere under src/ except core/rbac/, where
// resolve()'s cache/versioning logic legitimately has no other way to work.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SRC_ROOT = fileURLToPath(new URL("../src", import.meta.url));
const ALLOWED_RELATIVE_DIR = join("core", "rbac");
const PATTERNS = ["role ===", "role.name =="];

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
  if (relativePath === ALLOWED_RELATIVE_DIR || relativePath.startsWith(`${ALLOWED_RELATIVE_DIR}${sep}`)) {
    continue;
  }

  const content = readFileSync(file, "utf8");
  content.split("\n").forEach((line, index) => {
    for (const pattern of PATTERNS) {
      if (line.includes(pattern)) {
        violations.push(`  src/${relativePath}:${index + 1}: ${line.trim()}`);
      }
    }
  });
}

if (violations.length > 0) {
  console.error(
    `Inline role-name checks (${PATTERNS.map((p) => `"${p}"`).join(", ")}) must only appear in src/${ALLOWED_RELATIVE_DIR}/. Found:\n${violations.join("\n")}`,
  );
  process.exit(1);
}

console.log(`OK: no inline role-name checks outside src/${ALLOWED_RELATIVE_DIR}/`);
