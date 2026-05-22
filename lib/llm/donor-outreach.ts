import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  monitoringResults,
  results as resultsTable,
  touchpointsPotential,
} from "@/lib/db/schema";
import {
  aggregatePendingByProspect,
  toAgentResultShape,
  type AggregatedProspect,
} from "@/lib/llm/aggregate";
import { getDossierText } from "@/lib/dossiers";
import { runAgent, type AgentCallResult } from "@/lib/llm/agent";
import { stageToDbEnum, type AgentOutput } from "@/lib/llm/schema";
import {
  parseRecipientsEnv,
  recordEmptyBriefing,
  sendProspectBriefing,
} from "@/lib/email/send-briefing";

export type DonorOutreachSummary = {
  prospectsAggregated: number;
  prospectsScored: number;
  prospectsFailed: number;
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
};

export async function runDonorOutreach(
  options: DonorOutreachOptions
): Promise<DonorOutreachSummary> {
  const agentFn = options.agentFn ?? runAgent;
  const dossierFn = options.dossierFn ?? getDossierText;
  const alertThreshold = options.alertThreshold ?? 8;
  const recipients = parseRecipientsEnv();
  const runDate = today();

  const aggregated = await aggregatePendingByProspect();
  const summary: DonorOutreachSummary = {
    prospectsAggregated: aggregated.length,
    prospectsScored: 0,
    prospectsFailed: 0,
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

  for (const prospect of aggregated) {
    const outcome = await scoreProspect({
      prospect,
      runDate,
      cronRunId: options.cronRunId,
      recipients,
      alertThreshold,
      agentFn,
      dossierFn,
    });
    summary.llmCostUsd += outcome.llmCostUsd;
    summary.llmCallCount += outcome.llmCallCount;
    if (outcome.kind === "scored") {
      summary.prospectsScored += 1;
      summary.resultsProcessed += outcome.resultIds.length;
      if (outcome.briefingSent === true) summary.briefingsSent += 1;
      if (outcome.briefingSent === false) summary.briefingsFailed += 1;
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

  if (summary.briefingsSent === 0 && summary.briefingsFailed === 0) {
    await recordEmptyBriefing({
      cronRunId: options.cronRunId,
      recipients,
      prospectCount: summary.prospectsScored,
      llmCostUsd: summary.llmCostUsd,
      llmCallCount: summary.llmCallCount,
    });
  }

  return summary;
}

type ProspectOutcome =
  | {
      kind: "scored";
      resultIds: string[];
      briefingSent: boolean | null; // null = no email (below threshold)
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
  cronRunId: string | null;
  recipients: string[];
  alertThreshold: number;
  agentFn: NonNullable<DonorOutreachOptions["agentFn"]>;
  dossierFn: NonNullable<DonorOutreachOptions["dossierFn"]>;
}): Promise<ProspectOutcome> {
  let context = "";
  try {
    context = await args.dossierFn({
      provider: args.prospect.dossierProvider,
      fileId: args.prospect.dossierFileId,
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

  const call = await args.agentFn(agentInputs);
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

  let briefingSent: boolean | null = null;
  let briefingId: string | null = null;
  const score = call.output.potential_touchpoint.priority_score;
  if (score >= args.alertThreshold) {
    const briefing = await sendProspectBriefing({
      cronRunId: args.cronRunId,
      fullName: args.prospect.fullName,
      agentOutput: call.output,
      recentTouchpoints: args.prospect.touchpoints,
      recipients: args.recipients,
      llmCostUsd,
      llmCallCount,
    });
    briefingId = briefing.briefingId;
    briefingSent = briefing.status === "sent";
  }

  try {
    await persistAgentOutcome({
      prospectId: args.prospect.prospectId,
      runDate: args.runDate,
      agentOutput: call.output,
      briefingId,
      resultIds: args.prospect.resultIds,
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
    briefingSent,
    llmCostUsd,
    llmCallCount,
  };
}

async function persistAgentOutcome(args: {
  prospectId: string;
  runDate: string;
  agentOutput: AgentOutput;
  briefingId: string | null;
  resultIds: string[];
}): Promise<void> {
  const { agentOutput, prospectId, runDate, briefingId, resultIds } = args;
  const id = `${prospectId}_${runDate}`;

  await db
    .insert(monitoringResults)
    .values({
      id,
      prospectId,
      runDate,
      stage: stageToDbEnum(agentOutput.relationship_state.stage),
      responsiveness: agentOutput.relationship_state.responsiveness,
      momentum: agentOutput.relationship_state.momentum,
      interpretation: agentOutput.relationship_state.interpretation,
      summary: agentOutput.monitoring_results.summary,
      keyAlerts: agentOutput.monitoring_results.key_alerts,
      briefingId,
    })
    .onConflictDoUpdate({
      target: monitoringResults.id,
      set: {
        stage: stageToDbEnum(agentOutput.relationship_state.stage),
        responsiveness: agentOutput.relationship_state.responsiveness,
        momentum: agentOutput.relationship_state.momentum,
        interpretation: agentOutput.relationship_state.interpretation,
        summary: agentOutput.monitoring_results.summary,
        keyAlerts: agentOutput.monitoring_results.key_alerts,
        briefingId,
      },
    });

  if (agentOutput.potential_touchpoint.touchpoint_type !== "no_action") {
    await db
      .insert(touchpointsPotential)
      .values({
        id,
        prospectId,
        runDate,
        touchpointType: agentOutput.potential_touchpoint.touchpoint_type,
        priorityScore: agentOutput.potential_touchpoint.priority_score,
        engagementRationale: agentOutput.potential_touchpoint.engagement_rationale,
        draftContent: agentOutput.potential_touchpoint.draft_content,
        briefingId,
      })
      .onConflictDoUpdate({
        target: touchpointsPotential.id,
        set: {
          touchpointType: agentOutput.potential_touchpoint.touchpoint_type,
          priorityScore: agentOutput.potential_touchpoint.priority_score,
          engagementRationale: agentOutput.potential_touchpoint.engagement_rationale,
          draftContent: agentOutput.potential_touchpoint.draft_content,
          briefingId,
        },
      });
  }

  if (resultIds.length > 0) {
    await db
      .update(resultsTable)
      .set({ processedStatus: "processed", processedAt: new Date() })
      .where(inArray(resultsTable.id, resultIds));
  }
}

function today(): string {
  // YYYY-MM-DD in UTC, matching cron run scheduling.
  return new Date().toISOString().slice(0, 10);
}
