import { touchpointType } from "@/lib/db/schema";
import { upsertAssignedTouchpoint } from "./actions";

// Picker options: all DB touchpoint types except "no_action" (not a logged
// interaction). Defined here, not in the "use server" actions file.
const assignedTypeOptions = touchpointType.enumValues.filter((t) => t !== "no_action");

export type AssignedRow = {
  id: string;
  prospectId: string;
  touchpointType: string;
  completedDate: string;
  summary: string;
  response: string | null;
  nextStep: string | null;
};

// Add/edit form for an Assigned touchpoint (Preet's completed-interaction log).
// `existing` undefined = add; provided = edit (hidden id drives upsert).
export function TouchpointForm({
  prospects,
  existing,
  submitLabel,
}: {
  prospects: { id: string; fullName: string }[];
  existing?: AssignedRow;
  submitLabel: string;
}) {
  return (
    <form action={upsertAssignedTouchpoint} className="grid max-w-2xl gap-3 text-sm">
      {existing && <input type="hidden" name="id" value={existing.id} />}
      <div className="grid grid-cols-2 gap-3">
        <label className="font-medium text-zinc-700">
          Prospect
          <select
            name="prospectId"
            required
            defaultValue={existing?.prospectId ?? ""}
            className="mt-1 block w-full rounded border border-zinc-300 px-2 py-1.5"
          >
            <option value="" disabled>
              Select…
            </option>
            {prospects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName}
              </option>
            ))}
          </select>
        </label>
        <label className="font-medium text-zinc-700">
          Type
          <select
            name="touchpointType"
            required
            defaultValue={existing?.touchpointType ?? ""}
            className="mt-1 block w-full rounded border border-zinc-300 px-2 py-1.5"
          >
            <option value="" disabled>
              Select…
            </option>
            {assignedTypeOptions.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="font-medium text-zinc-700">
        Completed date
        <input
          type="date"
          name="completedDate"
          required
          defaultValue={existing?.completedDate ?? ""}
          className="mt-1 block rounded border border-zinc-300 px-2 py-1.5"
        />
      </label>
      <label className="font-medium text-zinc-700">
        Summary
        <input
          name="summary"
          required
          defaultValue={existing?.summary ?? ""}
          placeholder="What happened"
          className="mt-1 block w-full rounded border border-zinc-300 px-2 py-1.5"
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="font-medium text-zinc-700">
          Response
          <input
            name="response"
            defaultValue={existing?.response ?? ""}
            placeholder="How they responded (optional)"
            className="mt-1 block w-full rounded border border-zinc-300 px-2 py-1.5"
          />
        </label>
        <label className="font-medium text-zinc-700">
          Next step
          <input
            name="nextStep"
            defaultValue={existing?.nextStep ?? ""}
            placeholder="Optional"
            className="mt-1 block w-full rounded border border-zinc-300 px-2 py-1.5"
          />
        </label>
      </div>
      <button className="w-fit rounded bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700">
        {submitLabel}
      </button>
    </form>
  );
}
