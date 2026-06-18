/**
 * Phase 2E — live eval runner (`pnpm test:eval`).
 *
 * Loads active eval cases from Postgres, runs each through the agent (live
 * OpenRouter call), scores the output with the deterministic judge (contract +
 * 6-kind binary checks) and the LLM rubric judge, aggregates violations, writes
 * an `eval_run` summary row, and prints a per-case table.
 *
 * This is NOT part of the Vitest unit suite — it spends real tokens and hits
 * Postgres. It is the proof-gate tool (run on the v1 prompt, then on a model
 * swap). A hard --max-cost ceiling protects the $25/mo OpenRouter cap.
 *
 * Usage:
 *   pnpm test:eval                          # all active cases, default model
 *   pnpm test:eval --model anthropic/claude-sonnet-4.6
 *   pnpm test:eval --limit 2 --max-cost 1   # quick, capped
 *   pnpm test:eval --prompt-version v1
 *   pnpm test:eval --dry-run                # don't write an eval_run row
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { evalCases, evalRuns } from "@/lib/db/schema";
import { runAgent } from "@/lib/llm/agent";
import type { PromptVersion } from "@/lib/llm/prompts";
import {
  aggregateViolations,
  buildContext,
  runBinaryChecks,
  type BinaryCheck,
} from "@/lib/llm/judge";
import { countRubricViolations, judgeRubric } from "@/lib/llm/rubric-judge";
import type { RubricQuestion } from "@/lib/llm/eval-cases";

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is not set");

  const model = argValue("--model"); // undefined → runAgent default
  const promptVersion = (argValue("--prompt-version") ?? "v1") as PromptVersion;
  const limit = Number(argValue("--limit") ?? "0"); // 0 → no limit
  const maxCost = Number(argValue("--max-cost") ?? "5");
  const onlyCase = argValue("--case");
  const dryRun = process.argv.includes("--dry-run");

  const where = onlyCase
    ? and(eq(evalCases.active, true), eq(evalCases.label, onlyCase))
    : and(eq(evalCases.active, true), eq(evalCases.promptVersion, promptVersion));

  let cases = await db.select().from(evalCases).where(where);
  if (limit > 0) cases = cases.slice(0, limit);

  if (cases.length === 0) {
    console.log("[eval] no active cases found — run `pnpm seed:eval-cases` first.");
    process.exit(0);
  }

  const resolvedModel = model ?? process.env.OPENROUTER_AGENT_MODEL ?? "anthropic/claude-sonnet-4.6";
  console.log(`[eval] ${cases.length} case(s) · model=${resolvedModel} · prompt=${promptVersion} · max-cost=$${maxCost}`);

  let runId: string | null = null;
  if (!dryRun) {
    const [run] = await db
      .insert(evalRuns)
      .values({ model: resolvedModel, promptVersion, status: "running" })
      .returning({ id: evalRuns.id });
    runId = run.id;
  }

  let totalCost = 0;
  let totalViolations = 0;
  let contractViolations = 0;
  let binaryViolations = 0;
  let rubricViolations = 0;
  let casesPassed = 0;
  let casesRun = 0;
  let stoppedForCost = false;
  const perCase: Record<string, unknown>[] = [];

  for (const c of cases) {
    if (totalCost >= maxCost) {
      stoppedForCost = true;
      console.log(`[eval] cost ceiling $${maxCost} reached — stopping after ${casesRun} case(s)`);
      break;
    }

    const input = c.input as {
      fullName: string;
      contextText: string;
      results: unknown[];
      touchpoints: unknown[];
    };

    const agent = await runAgent(
      { fullName: input.fullName, contextText: input.contextText, results: input.results, touchpoints: input.touchpoints },
      { model, promptVersion }
    );
    const agentCost = agent.costUsd ?? 0;
    const rawOutput = agent.rawOutput ?? "";

    const { ctx, contract } = buildContext(input, rawOutput);
    const binaryResults = runBinaryChecks((c.binaryChecks as BinaryCheck[]) ?? [], ctx);

    const judge = await judgeRubric({
      expectedBehavior: c.expectedBehavior,
      rubric: (c.rubric as RubricQuestion[]) ?? [],
      input,
      output: ctx.parsed_output ?? rawOutput,
    });
    const judgeCost = judge.ok ? judge.costUsd : 0;
    const rubricCount = judge.ok ? countRubricViolations(judge.violations) : 0;

    const agg = aggregateViolations({
      binaryResults,
      contractValid: contract.valid,
      rubricViolations: rubricCount,
    });

    totalCost += agentCost + judgeCost;
    totalViolations += agg.total;
    contractViolations += agg.contract;
    binaryViolations += agg.binary;
    rubricViolations += agg.rubric;
    if (agg.total === 0) casesPassed += 1;
    casesRun += 1;

    const failedChecks = binaryResults.filter((r) => !r.passed).map((r) => r.check_id);
    perCase.push({
      label: c.label,
      total: agg.total,
      contract: agg.contract,
      binary: agg.binary,
      rubric: agg.rubric,
      agentOk: agent.ok,
      failedChecks,
      contractErrors: contract.errors,
      judgeError: judge.ok ? null : judge.errorMessage,
    });

    const mark = agg.total === 0 ? "PASS" : `${agg.total} viol`;
    console.log(
      `  ${mark.padEnd(8)} ${c.label.padEnd(34)} c=${agg.contract} b=${agg.binary} r=${agg.rubric}` +
        (failedChecks.length ? `  [${failedChecks.join(", ")}]` : "")
    );
  }

  if (runId) {
    await db
      .update(evalRuns)
      .set({
        completedAt: new Date(),
        status: "completed",
        caseCount: casesRun,
        casesPassed,
        totalViolations,
        contractViolations,
        binaryViolations,
        rubricViolations,
        llmCostUsd: totalCost.toFixed(4),
        metadata: { perCase, stoppedForCost, maxCost },
      })
      .where(eq(evalRuns.id, runId));
  }

  console.log("");
  console.log(`[eval] ${casesPassed}/${casesRun} cases clean · ${totalViolations} total violations ` +
    `(contract=${contractViolations} binary=${binaryViolations} rubric=${rubricViolations}) · cost=$${totalCost.toFixed(4)}`);
  if (runId) console.log(`[eval] eval_run row: ${runId}`);

  // Non-zero exit when any case had violations, so CI/manual runs can gate.
  process.exit(totalViolations === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("[eval] uncaught", err);
  process.exit(1);
});
