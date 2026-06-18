/**
 * Phase 2E — seed eval cases into Postgres.
 *
 * Loads the curated, synthetic eval cases (lib/llm/eval-cases.ts) into the
 * `eval_case` table. Cases live in Postgres (UI-editable) — there is NO Google
 * Sheet dependency in the productionalized system. The historical Phase 1
 * dataset (real prospect PII) is intentionally not imported here.
 *
 * Idempotent: upserts by `label` so re-running refreshes the seed in place.
 *
 * Usage:
 *   pnpm seed:eval-cases            # upsert curated cases
 *   pnpm seed:eval-cases --reset    # delete all cases first, then seed
 */
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { evalCases } from "@/lib/db/schema";
import { CURATED_EVAL_CASES } from "@/lib/llm/eval-cases";

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set — run with `pnpm seed:eval-cases` (loads .env.local)."
    );
  }
  const reset = process.argv.includes("--reset");
  if (reset) {
    await db.delete(evalCases);
    console.log("[seed] cleared all eval_case rows");
  }

  let inserted = 0;
  let updated = 0;
  for (const c of CURATED_EVAL_CASES) {
    const existing = await db
      .select({ id: evalCases.id })
      .from(evalCases)
      .where(eq(evalCases.label, c.label));

    const row = {
      label: c.label,
      promptVersion: c.promptVersion,
      input: c.input as Record<string, unknown>,
      binaryChecks: c.binaryChecks as unknown[],
      rubric: c.rubric as unknown[],
      expectedBehavior: c.expectedBehavior,
      active: true,
    };

    if (existing.length > 0) {
      await db.update(evalCases).set(row).where(eq(evalCases.id, existing[0].id));
      updated += 1;
    } else {
      await db.insert(evalCases).values(row);
      inserted += 1;
    }
  }

  console.log(`[seed] done — ${inserted} inserted, ${updated} updated (${CURATED_EVAL_CASES.length} curated cases)`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[seed] failed", err);
    process.exit(1);
  });
