import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { prospects, touchpointsPotential, touchpointsAssigned } from "@/lib/db/schema";
import { approveTouchpoint, rejectTouchpoint, promoteTouchpoint } from "./actions";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default async function TouchpointsPage() {
  const [open, history] = await Promise.all([
    db
      .select({
        tp: touchpointsPotential,
        prospectName: prospects.fullName,
      })
      .from(touchpointsPotential)
      .innerJoin(prospects, eq(touchpointsPotential.prospectId, prospects.id))
      .where(inArray(touchpointsPotential.reviewStatus, ["pending", "approved"]))
      .orderBy(desc(touchpointsPotential.priorityScore), desc(touchpointsPotential.runDate)),
    db
      .select({
        id: touchpointsAssigned.id,
        touchpointType: touchpointsAssigned.touchpointType,
        completedDate: touchpointsAssigned.completedDate,
        summary: touchpointsAssigned.summary,
        prospectName: prospects.fullName,
      })
      .from(touchpointsAssigned)
      .innerJoin(prospects, eq(touchpointsAssigned.prospectId, prospects.id))
      .orderBy(desc(touchpointsAssigned.completedDate))
      .limit(50),
  ]);

  return (
    <main>
      <h1 className="text-xl font-semibold">Touchpoints</h1>

      <h2 className="mt-6 text-sm font-semibold text-zinc-700">
        Recommendations awaiting action ({open.length})
      </h2>
      {open.length === 0 && (
        <p className="mt-2 text-sm text-zinc-400">
          Nothing pending — recommendations appear here after the weekly agent run.
        </p>
      )}
      <div className="mt-2 space-y-4">
        {open.map(({ tp, prospectName }) => (
          <div key={tp.id} className="rounded-lg border border-zinc-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="font-medium">{prospectName}</span>
                <span className="ml-2 font-mono text-xs text-zinc-500">
                  {tp.touchpointType} · score {tp.priorityScore}/10 · week of {tp.runDate}
                </span>
              </div>
              <span
                className={
                  tp.reviewStatus === "approved"
                    ? "rounded bg-green-50 px-2 py-0.5 text-xs text-green-700"
                    : "rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-700"
                }
              >
                {tp.reviewStatus}
              </span>
            </div>

            {tp.engagementRationale && (
              <p className="mt-2 text-sm text-zinc-600">{tp.engagementRationale}</p>
            )}
            {tp.draftContent && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-zinc-500">Draft content</summary>
                <pre className="mt-1 whitespace-pre-wrap rounded bg-zinc-50 p-3 text-xs text-zinc-700">
                  {tp.draftContent}
                </pre>
              </details>
            )}

            {tp.reviewStatus === "pending" && (
              <div className="mt-3 flex gap-2">
                <form
                  action={async () => {
                    "use server";
                    await approveTouchpoint(tp.id);
                  }}
                >
                  <button className="rounded bg-green-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-600">
                    Approve
                  </button>
                </form>
                <form
                  action={async () => {
                    "use server";
                    await rejectTouchpoint(tp.id);
                  }}
                >
                  <button className="rounded border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100">
                    Reject
                  </button>
                </form>
              </div>
            )}

            {tp.reviewStatus === "approved" && (
              <details className="mt-3">
                <summary className="cursor-pointer text-xs font-medium text-blue-700">
                  Mark completed (promote to history)
                </summary>
                <form
                  action={async (formData: FormData) => {
                    "use server";
                    await promoteTouchpoint(tp.id, formData);
                  }}
                  className="mt-2 grid max-w-lg gap-3 text-sm"
                >
                  <label className="font-medium text-zinc-700">
                    Completed date
                    <input
                      type="date"
                      name="completedDate"
                      defaultValue={todayIso()}
                      required
                      className="mt-1 block rounded border border-zinc-300 px-2 py-1.5"
                    />
                  </label>
                  <label className="font-medium text-zinc-700">
                    Summary
                    <input
                      name="summary"
                      required
                      placeholder="What was done"
                      className="mt-1 block w-full rounded border border-zinc-300 px-2 py-1.5"
                    />
                  </label>
                  <label className="font-medium text-zinc-700">
                    Response
                    <input
                      name="response"
                      placeholder="How they responded (optional)"
                      className="mt-1 block w-full rounded border border-zinc-300 px-2 py-1.5"
                    />
                  </label>
                  <label className="font-medium text-zinc-700">
                    Next step
                    <input
                      name="nextStep"
                      placeholder="Optional"
                      className="mt-1 block w-full rounded border border-zinc-300 px-2 py-1.5"
                    />
                  </label>
                  <button className="w-fit rounded bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700">
                    Promote to history
                  </button>
                </form>
              </details>
            )}
          </div>
        ))}
      </div>

      <h2 className="mt-10 text-sm font-semibold text-zinc-700">History (last 50)</h2>
      <div className="mt-2 overflow-hidden rounded-lg border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs text-zinc-500">
            <tr>
              <th className="px-3 py-2 font-medium">Prospect</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Summary</th>
            </tr>
          </thead>
          <tbody>
            {history.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-6 text-center text-zinc-400">No history.</td></tr>
            )}
            {history.map((h) => (
              <tr key={h.id} className="border-t border-zinc-100">
                <td className="px-3 py-2 whitespace-nowrap">{h.prospectName}</td>
                <td className="px-3 py-2 font-mono text-xs">{h.touchpointType}</td>
                <td className="px-3 py-2 whitespace-nowrap text-zinc-500">{h.completedDate}</td>
                <td className="max-w-md px-3 py-2 text-zinc-600">
                  <span className="line-clamp-2">{h.summary}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
