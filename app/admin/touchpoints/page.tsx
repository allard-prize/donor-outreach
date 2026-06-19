import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { prospects, touchpointsAssigned } from "@/lib/db/schema";

// Assigned touchpoints = Preet's log of completed interactions, fed to the agent
// as engagement history. The Phase 1 "Potential" review queue was dropped in
// Phase 2G. Inline editing (add/edit/delete) lands in the next dashboard update;
// the CRUD server actions already exist in ./actions.ts.
export default async function TouchpointsPage() {
  const history = await db
    .select({
      id: touchpointsAssigned.id,
      touchpointType: touchpointsAssigned.touchpointType,
      completedDate: touchpointsAssigned.completedDate,
      summary: touchpointsAssigned.summary,
      response: touchpointsAssigned.response,
      prospectName: prospects.fullName,
    })
    .from(touchpointsAssigned)
    .innerJoin(prospects, eq(touchpointsAssigned.prospectId, prospects.id))
    .orderBy(desc(touchpointsAssigned.completedDate))
    .limit(200);

  return (
    <main>
      <h1 className="text-xl font-semibold">Touchpoints</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Completed interactions, logged here and fed to the agent as engagement history.
      </p>

      <div className="mt-4 overflow-hidden rounded-lg border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs text-zinc-500">
            <tr>
              <th className="px-3 py-2 font-medium">Prospect</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Summary</th>
              <th className="px-3 py-2 font-medium">Response</th>
            </tr>
          </thead>
          <tbody>
            {history.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-zinc-400">
                  No touchpoints logged.
                </td>
              </tr>
            )}
            {history.map((h) => (
              <tr key={h.id} className="border-t border-zinc-100">
                <td className="px-3 py-2 whitespace-nowrap">{h.prospectName}</td>
                <td className="px-3 py-2 font-mono text-xs">{h.touchpointType}</td>
                <td className="px-3 py-2 whitespace-nowrap text-zinc-500">{h.completedDate}</td>
                <td className="max-w-md px-3 py-2 text-zinc-600">
                  <span className="line-clamp-2">{h.summary}</span>
                </td>
                <td className="px-3 py-2 text-zinc-500">{h.response ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
