/**
 * Fixture-based smoke test for the Phase 2C donor-outreach pipeline.
 *
 * Seeds an isolated prospect + a couple of pending results, runs the
 * orchestrator with a stubbed agent (no OpenRouter spend, no Gmail send),
 * asserts the expected rows landed, then tears the fixture down.
 *
 * Usage:
 *   pnpm tsx --env-file=.env.local scripts/smoke-donor-outreach.ts
 *
 * Exits non-zero on any failed assertion.
 */
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  briefings,
  monitoringResults,
  prospects,
  results,
} from "@/lib/db/schema";
import {
  runDonorOutreach,
  type DonorOutreachOptions,
} from "@/lib/llm/donor-outreach";
import type { AgentOutput } from "@/lib/llm/schema";
import type { AgentCallResult } from "@/lib/llm/agent";

const FIXTURE_PREFIX = "smoke_phase2c_";

const stubbedAgentOutput: AgentOutput = {
  relationship_state: {
    stage: "early",
    responsiveness: "low",
    momentum: "stable",
    interpretation:
      "Smoke fixture — relationship is in an early stage with one inbound LinkedIn signal and no outreach reciprocity yet.",
  },
  monitoring_results: {
    summary:
      "Fixture donor recently posted about anti-corruption award; no direct engagement history.",
    key_alerts: [
      {
        alert_source: "linkedin",
        headline: "Fixture LinkedIn post",
        content_summary: "Spoke at fictional anti-corruption summit.",
        source_link: "https://linkedin.com/posts/fixture-1",
      },
    ],
  },
  potential_touchpoint: {
    touchpoint_type: "congratulations",
    priority_score: 9,
    engagement_rationale:
      "Why now: fixture donor's anti-corruption summit appearance on 2026-05-21 creates a fresh, dated opening that aligns with Allard Prize's mission and warrants a brief congratulatory note before the moment cools.",
    draft_content:
      "Hi {fixture name}, congratulations on your remarks at the anti-corruption summit — your framing of accountability as a systems problem resonates with the work the Allard Prize Foundation aims to amplify.",
  },
};

function stubbedAgent(): NonNullable<DonorOutreachOptions["agentFn"]> {
  return async (): Promise<AgentCallResult> => ({
    ok: true,
    output: stubbedAgentOutput,
    rawOutput: JSON.stringify(stubbedAgentOutput),
    model: "stub/sonnet-4.6",
    promptVersion: "v1",
    costUsd: 0.01,
    promptTokens: 1500,
    completionTokens: 400,
    latencyMs: 25,
  });
}

function stubbedDossier(): NonNullable<DonorOutreachOptions["dossierFn"]> {
  return async () =>
    "Profile: institutional funder. Mission alignment: high. Engagement notes: none on file.";
}

async function seedFixture(
  prospectId: string
): Promise<{ resultIds: string[]; dupId: string }> {
  await db
    .insert(prospects)
    .values({
      id: prospectId,
      fullName: "Phase2C Smoke Donor",
      profileType: "institutional_funder",
      emailEnabled: false,
      linkedInEnabled: true,
      dossierProvider: null,
      dossierFileId: null,
    })
    .onConflictDoNothing();

  const seededResults = [
    {
      id: `${FIXTURE_PREFIX}r1_${prospectId}`,
      prospectId,
      sourceType: "rss" as const,
      title: "Fixture RSS headline",
      link: "https://example.com/fixture-rss",
      pubDate: new Date("2026-05-20T12:00:00Z"),
      contentSnippet: "Fixture RSS body content for smoke test.",
      processedStatus: "pending" as const,
    },
    {
      id: `${FIXTURE_PREFIX}r2_${prospectId}`,
      prospectId,
      sourceType: "linkedin_post" as const,
      title: "Fixture LinkedIn post",
      link: "https://linkedin.com/posts/fixture-1",
      pubDate: new Date("2026-05-21T15:00:00Z"),
      contentSnippet: "Fictional anti-corruption summit remarks.",
      processedStatus: "pending" as const,
    },
    {
      // Duplicate RSS title — deduped out of the LLM payload, so it must be
      // resolved as `skipped` (not left pending).
      id: `${FIXTURE_PREFIX}r3dup_${prospectId}`,
      prospectId,
      sourceType: "rss" as const,
      title: "Fixture RSS headline",
      link: "https://example.com/fixture-rss-dup",
      pubDate: new Date("2026-05-22T12:00:00Z"),
      contentSnippet: "Duplicate-title RSS body for skip test.",
      processedStatus: "pending" as const,
    },
  ];
  await db.insert(results).values(seededResults).onConflictDoNothing();
  return { resultIds: seededResults.map((r) => r.id), dupId: `${FIXTURE_PREFIX}r3dup_${prospectId}` };
}

async function teardownFixture(prospectId: string, resultIds: string[]): Promise<void> {
  await db.delete(monitoringResults).where(eq(monitoringResults.prospectId, prospectId));
  await db.delete(results).where(inArray(results.id, resultIds));
  await db.delete(prospects).where(eq(prospects.id, prospectId));
}

async function assertPersistedRows(prospectId: string): Promise<void> {
  const monRows = await db
    .select()
    .from(monitoringResults)
    .where(eq(monitoringResults.prospectId, prospectId));
  if (monRows.length !== 1) {
    throw new Error(`expected 1 monitoring_result row, got ${monRows.length}`);
  }
  // The recommendation now lives on the assessment row (Phase 2G dedup).
  if (monRows[0].priorityScore !== 9) {
    throw new Error(
      `monitoring_result.priority_score expected 9, got ${monRows[0].priorityScore}`
    );
  }
  if (monRows[0].touchpointType !== "congratulations") {
    throw new Error(
      `monitoring_result.touchpoint_type expected congratulations, got ${monRows[0].touchpointType}`
    );
  }
}

async function assertResultsResolved(resultIds: string[], dupId: string): Promise<void> {
  const rows = await db
    .select({ id: results.id, status: results.processedStatus })
    .from(results)
    .where(inArray(results.id, resultIds));
  const byId = new Map(rows.map((r) => [r.id, r.status]));
  // No seeded result should remain pending — the queue must fully resolve.
  const stillPending = rows.filter((r) => r.status === "pending").map((r) => r.id);
  if (stillPending.length > 0) {
    throw new Error(`expected no pending results, still pending: ${stillPending.join(", ")}`);
  }
  // The duplicate-title RSS must be skipped, not processed.
  if (byId.get(dupId) !== "skipped") {
    throw new Error(`expected dup result ${dupId} to be 'skipped', got '${byId.get(dupId)}'`);
  }
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set — load .env.local with `pnpm tsx --env-file=.env.local`.");
  }
  const prospectId = `${FIXTURE_PREFIX}${Date.now()}`;
  console.log(`[smoke] seeding fixture prospect ${prospectId}`);
  const { resultIds, dupId } = await seedFixture(prospectId);
  let failure: unknown = null;
  try {
    const summary = await runDonorOutreach({
      cronRunId: null,
      agentFn: stubbedAgent(),
      dossierFn: stubbedDossier(),
      // CRITICAL: scope to the fixture only — runDonorOutreach otherwise
      // processes every pending prospect and would clobber real data.
      onlyProspectIds: [prospectId],
    });
    console.log("[smoke] orchestrator summary:", JSON.stringify(summary, null, 2));

    if (summary.prospectsScored < 1) {
      throw new Error(
        `expected at least 1 prospectsScored, got ${summary.prospectsScored}`
      );
    }
    if (summary.prospectsFailed !== 0) {
      throw new Error(
        `expected 0 prospectsFailed, got ${summary.prospectsFailed}: ${JSON.stringify(summary.failures)}`
      );
    }
    await assertPersistedRows(prospectId);
    await assertResultsResolved(resultIds, dupId);

    const briefingRows = await db
      .select({ id: briefings.id, status: briefings.status, alertCount: briefings.alertCount })
      .from(briefings)
      .orderBy(briefings.sentAt);
    const recentBriefing = briefingRows[briefingRows.length - 1];
    console.log(`[smoke] last briefing row: ${JSON.stringify(recentBriefing)}`);

    console.log("[smoke] PASS");
  } catch (err) {
    failure = err;
  } finally {
    console.log(`[smoke] teardown fixture ${prospectId}`);
    await teardownFixture(prospectId, resultIds);
  }
  if (failure) {
    console.error("[smoke] FAIL", failure);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[smoke] uncaught", err);
  process.exit(1);
});
