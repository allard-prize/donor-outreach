#!/usr/bin/env node
// Lint drizzle-kit-generated migration SQL files for destructive operations
// that are missing the `-- DESTRUCTIVE` annotation as the FIRST non-blank line
// of the file.
//
// Why: Auto-migrate on deploy is a foot-gun for column/table drops. Forcing an
// explicit annotation makes the destructive intent reviewable in the PR diff.
// CI runs this on every push touching drizzle/migrations/**.

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = "drizzle/migrations";
const DESTRUCTIVE_PATTERNS = [
  /\bDROP\s+TABLE\b/i,
  /\bDROP\s+COLUMN\b/i,
  /\bDROP\s+CONSTRAINT\b/i,
  /\bDROP\s+INDEX\b/i,
  /\bDROP\s+TYPE\b/i,
  /\bALTER\s+TYPE\b.*\bDROP\b/i,
  /\bALTER\s+TABLE\s+\S+\s+ALTER\s+COLUMN\s+\S+\s+TYPE\b/i,
  /\bALTER\s+TABLE\s+\S+\s+ALTER\s+COLUMN\s+\S+\s+SET\s+NOT\s+NULL\b/i,
  /\bTRUNCATE\b/i,
];
const ANNOTATION = /^\s*--\s*DESTRUCTIVE\b/i;

if (!existsSync(MIGRATIONS_DIR)) {
  console.log("No drizzle/migrations directory yet — nothing to lint.");
  process.exit(0);
}

const failures = [];

for (const entry of readdirSync(MIGRATIONS_DIR)) {
  if (!entry.endsWith(".sql")) continue;
  const sqlPath = join(MIGRATIONS_DIR, entry);
  if (!statSync(sqlPath).isFile()) continue;

  const content = readFileSync(sqlPath, "utf8");
  const hasDestructive = DESTRUCTIVE_PATTERNS.some((p) => p.test(content));
  if (!hasDestructive) continue;

  const firstNonBlank = content
    .split("\n")
    .find((line) => line.trim().length > 0) ?? "";
  if (!ANNOTATION.test(firstNonBlank)) {
    failures.push({ path: sqlPath, firstLine: firstNonBlank.trim() });
  }
}

if (failures.length > 0) {
  console.error("Destructive migrations missing `-- DESTRUCTIVE` annotation:");
  for (const f of failures) {
    console.error(`  ${f.path}`);
    console.error(`    first line was: ${f.firstLine || "(empty)"}`);
  }
  console.error(
    "\nAdd `-- DESTRUCTIVE` as the first line of the migration.sql to acknowledge intent."
  );
  process.exit(1);
}

console.log("All migrations OK.");
