import { profileType, type prospects } from "@/lib/db/schema";

export const PROFILE_TYPE_LABELS: Record<string, string> = {
  institutional_funder: "Institutional Funder",
  individual_donor: "Individual Donor",
  connector: "Connector",
  credibility_node: "Credibility Node",
  collaborator: "Collaborator",
  unknown: "Unknown (unclassified)",
};

type Prospect = typeof prospects.$inferSelect;

export function ProspectForm({
  action,
  prospect,
  submitLabel,
}: {
  action: (formData: FormData) => Promise<void>;
  prospect?: Prospect;
  submitLabel: string;
}) {
  return (
    <form action={action} className="mt-6 max-w-lg space-y-4">
      <div>
        <label className="block text-sm font-medium text-zinc-700">
          Full name
          <input
            name="fullName"
            defaultValue={prospect?.fullName ?? ""}
            required
            className="mt-1 block w-full rounded border border-zinc-300 px-3 py-2 text-sm"
          />
        </label>
        <p className="mt-1 text-xs text-zinc-500">
          Must exactly match the Gmail label name for email capture.
        </p>
      </div>

      <label className="block text-sm font-medium text-zinc-700">
        Profile type
        <select
          name="profileType"
          defaultValue={prospect?.profileType ?? "unknown"}
          className="mt-1 block w-full rounded border border-zinc-300 px-3 py-2 text-sm"
        >
          {profileType.enumValues.map((v) => (
            <option key={v} value={v}>
              {PROFILE_TYPE_LABELS[v] ?? v}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-sm font-medium text-zinc-700">
        LinkedIn URL
        <input
          name="linkedInUrl"
          defaultValue={prospect?.linkedInUrl ?? ""}
          placeholder="https://www.linkedin.com/in/… or /company/…"
          className="mt-1 block w-full rounded border border-zinc-300 px-3 py-2 text-sm"
        />
      </label>

      <div className="flex gap-6">
        <label className="flex items-center gap-2 text-sm text-zinc-700">
          <input
            type="checkbox"
            name="emailEnabled"
            defaultChecked={prospect?.emailEnabled ?? false}
          />
          Email capture
        </label>
        <label className="flex items-center gap-2 text-sm text-zinc-700">
          <input
            type="checkbox"
            name="linkedInEnabled"
            defaultChecked={prospect?.linkedInEnabled ?? false}
          />
          LinkedIn capture
        </label>
      </div>

      <label className="block text-sm font-medium text-zinc-700">
        Dossier file id (Google Doc)
        <input
          name="dossierFileId"
          defaultValue={prospect?.dossierFileId ?? ""}
          className="mt-1 block w-full rounded border border-zinc-300 px-3 py-2 font-mono text-xs"
        />
      </label>

      <button
        type="submit"
        className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
      >
        {submitLabel}
      </button>
    </form>
  );
}
