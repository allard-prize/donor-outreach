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
  touchpointsPotential,
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

async function seedFixture(prospectId: string): Promise<{ resultIds: string[] }> {
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
  ];
  await db.insert(results).values(seededResults).onConflictDoNothing();
  return { resultIds: seededResults.map((r) => r.id) };
}

async function teardownFixture(prospectId: string, resultIds: string[]): Promise<void> {
  await db.delete(monitoringResults).where(eq(monitoringResults.prospectId, prospectId));
  await db
    .delete(touchpointsPotential)
    .where(eq(touchpointsPotential.prospectId, prospectId));
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
  const tpRows = await db
    .select()
    .from(touchpointsPotential)
    .where(eq(touchpointsPotential.prospectId, prospectId));
  if (tpRows.length !== 1) {
    throw new Error(`expected 1 touchpoint_potential row, got ${tpRows.length}`);
  }
  if (tpRows[0].priorityScore !== 9) {
    throw new Error(
      `touchpoint_potential.priority_score expected 9, got ${tpRows[0].priorityScore}`
    );
  }
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set — load .env.local with `pnpm tsx --env-file=.env.local`.");
  }
  const prospectId = `${FIXTURE_PREFIX}${Date.now()}`;
  console.log(`[smoke] seeding fixture prospect ${prospectId}`);
  const { resultIds } = await seedFixture(prospectId);
  let failure: unknown = null;
  try {
    const summary = await runDonorOutreach({
      cronRunId: null,
      agentFn: stubbedAgent(),
      dossierFn: stubbedDossier(),
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
