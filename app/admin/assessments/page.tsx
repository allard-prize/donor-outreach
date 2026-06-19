import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { monitoringResults, prospects } from "@/lib/db/schema";
import { AssessmentCard, type Assessment } from "./assessment-card";

// The agent's weekly read of every prospect — the per-prospect detail behind the
// weekly digest. Defaults to the most recent week; week chips switch the view.
export default async function AssessmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const { week } = await searchParams;

  const weekRows = await db
    .selectDistinct({ runDate: monitoringResults.runDate })
    .from(monitoringResults)
    .orderBy(desc(monitoringResults.runDate))
    .limit(12);
  const weeks = weekRows.map((w) => w.runDate);

  if (weeks.length === 0) {
    return (
      <main>
        <h1 className="text-xl font-semibold">Assessments</h1>
        <p className="mt-2 text-sm text-zinc-400">
          No assessments yet — they appear here after each weekly run.
        </p>
      </main>
    );
  }

  const selected = week && weeks.includes(week) ? week : weeks[0];

  const rows = await db
    .select({
      id: monitoringResults.id,
      runDate: monitoringResults.runDate,
      stage: monitoringResults.stage,
      responsiveness: monitoringResults.responsiveness,
      momentum: monitoringResults.momentum,
      interpretation: monitoringResults.interpretation,
      summary: monitoringResults.summary,
      keyAlerts: monitoringResults.keyAlerts,
      touchpointType: monitoringResults.touchpointType,
      priorityScore: monitoringResults.priorityScore,
      engagementRationale: monitoringResults.engagementRationale,
      draftContent: monitoringResults.draftContent,
      prospectName: prospects.fullName,
    })
    .from(monitoringResults)
    .innerJoin(prospects, eq(monitoringResults.prospectId, prospects.id))
    .where(eq(monitoringResults.runDate, selected))
    .orderBy(desc(monitoringResults.priorityScore));

  return (
    <main>
      <h1 className="text-xl font-semibold">Assessments</h1>
      <p className="mt-1 text-sm text-zinc-500">
        The agent&apos;s weekly read of each prospect — the detail behind the digest.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {weeks.map((w) => (
          <Link
            key={w}
            href={`/admin/assessments?week=${w}`}
            className={`rounded px-2.5 py-1 text-xs ${
              w === selected
                ? "bg-zinc-900 text-white"
                : "border border-zinc-300 text-zinc-600 hover:bg-zinc-100"
            }`}
          >
            {w}
          </Link>
        ))}
      </div>

      <p className="mt-4 text-sm text-zinc-500">
        Week of {selected} · {rows.length} prospect(s)
      </p>
      <div className="mt-2 space-y-3">
        {rows.map((r) => (
          <AssessmentCard key={r.id} a={r as Assessment} prospectName={r.prospectName} />
        ))}
      </div>
    </main>
  );
}

export const dynamic = "force-dynamic";
