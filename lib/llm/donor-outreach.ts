import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { monitoringResults, results as resultsTable } from "@/lib/db/schema";
import {
  aggregatePendingByProspect,
  toAgentResultShape,
  type AggregatedProspect,
} from "@/lib/llm/aggregate";
import { getDossierText } from "@/lib/dossiers";
import { getStoredGraphToken } from "@/lib/msgraph/token-store";
import { runAgent, type AgentCallResult } from "@/lib/llm/agent";

// Process prospects with bounded concurrency so the weekly run finishes inside
// Vercel's 60s maxDuration (Hobby). Each prospect costs ~30-40s (SharePoint
// dossier read + OpenRouter agent call), so a narrow pool runs out the clock —
// a pool of 8 only clears ~14 prospects before the function is hard-killed,
// stranding a `running` cron row with no digest sent. A wide pool fires the
// whole roster in one wave (wall-clock ≈ the slowest single call). SCORING_BUDGET_MS
// is a soft deadline: once it passes, workers stop starting new prospects (those
// are left pending and picked up on the next run) so the function always returns
// and records its outcome instead of being killed mid-write. Per-call timeouts
// (see scoreProspect) keep any single agent call from blowing the budget.
const PROSPECT_CONCURRENCY = 24;
const SCORING_BUDGET_MS = 48_000;

async function mapPool<T, R>(
  items: T[],
  limit: number,
  deadline: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<(R | undefined)[]> {
  const results = new Array<R | undefined>(items.length).fill(undefined);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      if (Date.now() >= deadline) return; // budget exhausted — leave the rest pending
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  );
  return results;
}
import { stageToDbEnum, type AgentOutput } from "@/lib/llm/schema";
import {
  parseRecipientsEnv,
  recordEmptyBriefing,
  sendWeeklyDigest,
} from "@/lib/email/send-briefing";
import type { DigestEntry } from "@/lib/email/render-digest";

export type DonorOutreachSummary = {
  prospectsAggregated: number;
  prospectsScored: number;
  prospectsFailed: number;
  // Prospects the scoring budget ran out before reaching — left pending for the
  // next run. Non-zero marks the run `partial`.
  prospectsDeferred: number;
  briefingsSent: number;
  briefingsFailed: number;
  resultsProcessed: number;
  llmCostUsd: number;
  llmCallCount: number;
  failures: { prospectId: string; fullName: string; stage: string; error: string }[];
};

export type DonorOutreachOptions = {
  cronRunId: string | null;
  /**
   * Threshold above which a touchpoint becomes an emailed briefing. Default 8
   * matches Phase 1.
   */
  alertThreshold?: number;
  /**
   * Inject a fake agent runner for fixture-based smoke tests. When absent the
   * real OpenRouter client is used.
   */
  agentFn?: (
    inputs: Parameters<typeof runAgent>[0],
    opts?: Parameters<typeof runAgent>[1]
  ) => Promise<AgentCallResult>;
  /**
   * Inject a fake dossier reader for fixtures.
   */
  dossierFn?: typeof getDossierText;
  /**
   * Scope the run to specific prospects. The smoke test sets this to its
   * fixture id so it never touches real prospects (the orchestrator otherwise
   * processes every pending prospect).
   */
  onlyProspectIds?: string[];
};

export async function runDonorOutreach(
  options: DonorOutreachOptions
): Promise<DonorOutreachSummary> {
  const agentFn = options.agentFn ?? runAgent;
  const dossierFn = options.dossierFn ?? getDossierText;
  const alertThreshold = options.alertThreshold ?? 8;
  const recipients = parseRecipientsEnv();
  const runDate = today();

  const aggregated = await aggregatePendingByProspect({
    onlyProspectIds: options.onlyProspectIds,
  });
  const summary: DonorOutreachSummary = {
    prospectsAggregated: aggregated.length,
    prospectsScored: 0,
    prospectsFailed: 0,
    prospectsDeferred: 0,
    briefingsSent: 0,
    briefingsFailed: 0,
    resultsProcessed: 0,
    llmCostUsd: 0,
    llmCallCount: 0,
    failures: [],
  };

  if (aggregated.length === 0) {
    await recordEmptyBriefing({
      cronRunId: options.cronRunId,
      recipients,
      prospectCount: 0,
      llmCostUsd: 0,
      llmCallCount: 0,
    });
    return summary;
  }

  // Pre-acquire the SharePoint Graph token ONCE (it rotates the refresh token on
  // redemption — concurrent first-time acquisitions would race and invalidate
  // each other). Subsequent per-prospect reads reuse this token.
  let graphAccessToken: string | undefined;
  const needsGraph = aggregated.some(
    (p) => p.dossierProvider === "onedrive" && p.dossierFileId
  );
  if (needsGraph) {
    try {
      graphAccessToken = await getStoredGraphToken();
    } catch {
      // Leave undefined — per-prospect dossier reads will surface the error and
      // mark those prospects failed (partial run) rather than aborting.
    }
  }

  // Score prospects with bounded concurrency, persisting each assessment, then
  // send ONE weekly digest covering them all (replaces per-prospect emails).
  const deadline = Date.now() + SCORING_BUDGET_MS;
  const outcomes = await mapPool(
    aggregated,
    PROSPECT_CONCURRENCY,
    deadline,
    (prospect) =>
      scoreProspect({ prospect, runDate, agentFn, dossierFn, graphAccessToken, deadline })
  );

  const entries: DigestEntry[] = [];
  for (let i = 0; i < aggregated.length; i += 1) {
    const prospect = aggregated[i];
    const outcome = outcomes[i];
    if (!outcome) {
      // Scoring budget ran out before this prospect — its results stay pending
      // and are scored on the next run.
      summary.prospectsDeferred += 1;
      continue;
    }
    summary.llmCostUsd += outcome.llmCostUsd;
    summary.llmCallCount += outcome.llmCallCount;
    if (outcome.kind === "scored") {
      summary.prospectsScored += 1;
      summary.resultsProcessed += outcome.resultIds.length;
      entries.push({
        fullName: prospect.fullName,
        agentOutput: outcome.agentOutput,
        recentTouchpoints: prospect.touchpoints,
      });
    } else {
      summary.prospectsFailed += 1;
      summary.failures.push({
        prospectId: prospect.prospectId,
        fullName: prospect.fullName,
        stage: outcome.stage,
        error: outcome.error,
      });
    }
  }

  if (entries.length === 0) {
    // Every prospect failed — record a sentinel so an absent Tuesday row still
    // signals broken cron rather than a quiet week.
    await recordEmptyBriefing({
      cronRunId: options.cronRunId,
      recipients,
      prospectCount: 0,
      llmCostUsd: summary.llmCostUsd,
      llmCallCount: summary.llmCallCount,
    });
    return summary;
  }

  const digest = await sendWeeklyDigest({
    cronRunId: options.cronRunId,
    entries,
    alertThreshold,
    runDate,
    recipients,
    llmCostUsd: summary.llmCostUsd,
    llmCallCount: summary.llmCallCount,
  });
  summary.briefingsSent = digest.status === "sent" ? 1 : 0;
  summary.briefingsFailed = digest.status === "sent" ? 0 : 1;

  // Link this run's assessments to the digest briefing they were reported in.
  await db
    .update(monitoringResults)
    .set({ briefingId: digest.briefingId })
    .where(eq(monitoringResults.runDate, runDate));

  return summary;
}

type ProspectOutcome =
  | {
      kind: "scored";
      resultIds: string[];
      agentOutput: AgentOutput;
      llmCostUsd: number;
      llmCallCount: number;
    }
  | {
      kind: "failed";
      stage: "dossier" | "agent" | "persist";
      error: string;
      llmCostUsd: number;
      llmCallCount: number;
    };

async function scoreProspect(args: {
  prospect: AggregatedProspect;
  runDate: string;
  agentFn: NonNullable<DonorOutreachOptions["agentFn"]>;
  dossierFn: NonNullable<DonorOutreachOptions["dossierFn"]>;
  graphAccessToken?: string;
  deadline: number;
}): Promise<ProspectOutcome> {
  let context = "";
  try {
    context = await args.dossierFn({
      provider: args.prospect.dossierProvider,
      fileId: args.prospect.dossierFileId,
      graphAccessToken: args.graphAccessToken,
    });
  } catch (err) {
    return {
      kind: "failed",
      stage: "dossier",
      error: err instanceof Error ? err.message : String(err),
      llmCostUsd: 0,
      llmCallCount: 0,
    };
  }

  const agentInputs = {
    fullName: args.prospect.fullName,
    contextText: context,
    results: toAgentResultShape(args.prospect.results),
    touchpoints: args.prospect.touchpoints,
  };

  // Bound the call to the remaining scoring budget so one slow prospect can't
  // push the function past the 60s cap. A timed-out call returns ok:false →
  // failed outcome → results stay pending for the next run.
  const remainingMs = args.deadline - Date.now();
  const call = await args.agentFn(agentInputs, {
    timeoutMs: Math.max(5_000, remainingMs),
  });
  const llmCostUsd = call.costUsd;
  const llmCallCount = 1;

  if (!call.ok) {
    return {
      kind: "failed",
      stage: "agent",
      error: `${call.stage}: ${call.errorMessage}`,
      llmCostUsd,
      llmCallCount,
    };
  }

  try {
    await persistAgentOutcome({
      prospectId: args.prospect.prospectId,
      runDate: args.runDate,
      agentOutput: call.output,
      resultIds: args.prospect.resultIds,
      allResultIds: args.prospect.allResultIds,
    });
  } catch (err) {
    return {
      kind: "failed",
      stage: "persist",
      error: err instanceof Error ? err.message : String(err),
      llmCostUsd,
      llmCallCount,
    };
  }

  return {
    kind: "scored",
    resultIds: args.prospect.resultIds,
    agentOutput: call.output,
    llmCostUsd,
    llmCallCount,
  };
}

async function persistAgentOutcome(args: {
  prospectId: string;
  runDate: string;
  agentOutput: AgentOutput;
  resultIds: string[];
  allResultIds: string[];
}): Promise<void> {
  const { agentOutput, prospectId, runDate, resultIds, allResultIds } = args;
  const id = `${prospectId}_${runDate}`;
  const rs = agentOutput.relationship_state;
  const tp = agentOutput.potential_touchpoint;

  // One assessment row per prospect per week, carrying both the relationship
  // read and the agent's recommendation (the briefingId is linked after the
  // weekly digest is sent). Idempotent on re-run of the same week.
  const fields = {
    stage: stageToDbEnum(rs.stage),
    responsiveness: rs.responsiveness,
    momentum: rs.momentum,
    interpretation: rs.interpretation,
    summary: agentOutput.monitoring_results.summary,
    keyAlerts: agentOutput.monitoring_results.key_alerts,
    touchpointType: tp.touchpoint_type,
    priorityScore: tp.priority_score,
    engagementRationale: tp.engagement_rationale,
    draftContent: tp.draft_content,
  } as const;

  await db
    .insert(monitoringResults)
    .values({ id, prospectId, runDate, ...fields })
    .onConflictDoUpdate({ target: monitoringResults.id, set: { ...fields } });

  const now = new Date();
  if (resultIds.length > 0) {
    await db
      .update(resultsTable)
      .set({ processedStatus: "processed", processedAt: now })
      .where(inArray(resultsTable.id, resultIds));
  }

  // Fully resolve the prospect's pending queue: everything pending that wasn't
  // passed to the LLM (deduped duplicates + RSS overflow beyond the cap) is
  // marked `skipped`, so `pending` doesn't accumulate run over run.
  const passed = new Set(resultIds);
  const skippedIds = allResultIds.filter((rid) => !passed.has(rid));
  if (skippedIds.length > 0) {
    await db
      .update(resultsTable)
      .set({ processedStatus: "skipped", processedAt: now })
      .where(inArray(resultsTable.id, skippedIds));
  }
}

function today(): string {
  // YYYY-MM-DD in UTC, matching cron run scheduling.
  return new Date().toISOString().slice(0, 10);
}
