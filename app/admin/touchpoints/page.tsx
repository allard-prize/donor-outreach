import { asc, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { prospects, touchpointsAssigned } from "@/lib/db/schema";
import { deleteAssignedTouchpoint } from "./actions";
import { TouchpointForm, type AssignedRow } from "./touchpoint-form";

// Assigned touchpoints = Preet's log of completed interactions, fed to the agent
// as engagement history. Fully editable here (add / edit / delete). The Phase 1
// "Potential" review queue was dropped in Phase 2G.
export default async function TouchpointsPage() {
  const [prospectList, history] = await Promise.all([
    db
      .select({ id: prospects.id, fullName: prospects.fullName })
      .from(prospects)
      .where(isNull(prospects.archivedAt))
      .orderBy(asc(prospects.fullName)),
    db
      .select({
        id: touchpointsAssigned.id,
        prospectId: touchpointsAssigned.prospectId,
        touchpointType: touchpointsAssigned.touchpointType,
        completedDate: touchpointsAssigned.completedDate,
        summary: touchpointsAssigned.summary,
        response: touchpointsAssigned.response,
        nextStep: touchpointsAssigned.nextStep,
        prospectName: prospects.fullName,
      })
      .from(touchpointsAssigned)
      .innerJoin(prospects, eq(touchpointsAssigned.prospectId, prospects.id))
      .orderBy(desc(touchpointsAssigned.completedDate))
      .limit(300),
  ]);

  return (
    <main>
      <h1 className="text-xl font-semibold">Touchpoints</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Completed interactions, logged here and fed to the agent as engagement history.
      </p>

      <details className="mt-4 rounded-lg border border-zinc-200 bg-white p-4">
        <summary className="cursor-pointer text-sm font-medium text-zinc-700">
          + Add touchpoint
        </summary>
        <div className="mt-3">
          <TouchpointForm prospects={prospectList} submitLabel="Add touchpoint" />
        </div>
      </details>

      <div className="mt-4 overflow-hidden rounded-lg border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs text-zinc-500">
            <tr>
              <th className="px-3 py-2 font-medium">Prospect</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Summary</th>
              <th className="px-3 py-2 font-medium"></th>
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
              <tr key={h.id} className="border-t border-zinc-100 align-top">
                <td className="px-3 py-2 whitespace-nowrap">{h.prospectName}</td>
                <td className="px-3 py-2 font-mono text-xs">{h.touchpointType}</td>
                <td className="px-3 py-2 whitespace-nowrap text-zinc-500">{h.completedDate}</td>
                <td className="max-w-md px-3 py-2 text-zinc-600">
                  <span className="line-clamp-2">{h.summary}</span>
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs text-zinc-400">Edit</summary>
                    <div className="mt-2">
                      <TouchpointForm
                        prospects={prospectList}
                        existing={h as AssignedRow}
                        submitLabel="Save changes"
                      />
                    </div>
                  </details>
                </td>
                <td className="px-3 py-2">
                  <form
                    action={async () => {
                      "use server";
                      await deleteAssignedTouchpoint(h.id);
                    }}
                  >
                    <button className="rounded border border-zinc-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50">
                      Delete
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
