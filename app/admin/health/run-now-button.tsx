"use client";

import { runCronNow } from "./actions";

// Small client wrapper so a click can't accidentally fire a job — especially
// donor_outreach, which sends the real weekly digest email. `warn` carries the
// confirm message; jobs without it confirm with a generic prompt.
export function RunNowButton({ job, warn }: { job: string; warn?: string }) {
  return (
    <form
      action={runCronNow}
      onSubmit={(e) => {
        const msg = warn ?? `Run "${job}" now?`;
        if (!window.confirm(msg)) e.preventDefault();
      }}
    >
      <input type="hidden" name="job" value={job} />
      <button
        type="submit"
        className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100"
      >
        Run now
      </button>
    </form>
  );
}
