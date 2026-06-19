// Renders one weekly assessment (monitoring_result row) — the agent's read of a
// prospect plus its recommendation. Shared by the Assessments list and the
// per-prospect history on the prospect detail page.

type KeyAlert = {
  alert_source?: string;
  headline?: string;
  content_summary?: string;
  source_link?: string;
};

export type Assessment = {
  id: string;
  runDate: string;
  stage: string;
  responsiveness: string;
  momentum: string;
  interpretation: string;
  summary: string;
  keyAlerts: unknown;
  touchpointType: string | null;
  priorityScore: number | null;
  engagementRationale: string;
  draftContent: string;
};

function scoreClass(score: number | null): string {
  if (score == null) return "bg-zinc-100 text-zinc-500";
  if (score >= 8) return "bg-green-50 text-green-700";
  if (score >= 5) return "bg-amber-50 text-amber-700";
  return "bg-zinc-100 text-zinc-500";
}

export function AssessmentCard({
  a,
  prospectName,
}: {
  a: Assessment;
  prospectName?: string;
}) {
  const alerts = (Array.isArray(a.keyAlerts) ? a.keyAlerts : []) as KeyAlert[];
  const actionable = a.touchpointType != null && a.touchpointType !== "no_action";

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {prospectName && <span className="font-medium">{prospectName}</span>}
          <span className="font-mono text-xs text-zinc-500">week of {a.runDate}</span>
        </div>
        <span className={`rounded px-2 py-0.5 text-xs ${scoreClass(a.priorityScore)}`}>
          {a.priorityScore == null ? "—" : `${a.priorityScore}/10`}
          {a.touchpointType ? ` · ${a.touchpointType}` : ""}
        </span>
      </div>

      <p className="mt-2 text-xs text-zinc-500">
        {titleCase(a.stage)} · {titleCase(a.responsiveness)} responsiveness · {titleCase(a.momentum)} momentum
      </p>
      <p className="mt-2 text-sm text-zinc-700">{a.summary}</p>

      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-zinc-500">Detail</summary>
        <div className="mt-2 space-y-3 text-sm">
          {a.interpretation && (
            <p className="text-zinc-600">
              <span className="font-medium text-zinc-700">Interpretation:</span> {a.interpretation}
            </p>
          )}
          {alerts.length > 0 && (
            <div>
              <p className="font-medium text-zinc-700">Key alerts</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-zinc-600">
                {alerts.map((al, i) => (
                  <li key={i}>
                    <span className="text-xs uppercase text-zinc-400">{al.alert_source}</span>{" "}
                    <strong>{al.headline}</strong>
                    {al.content_summary ? ` — ${al.content_summary}` : ""}
                    {al.source_link ? (
                      <>
                        {" "}
                        <a href={al.source_link} target="_blank" className="text-blue-700 underline">
                          link
                        </a>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {actionable && (
            <div>
              <p className="font-medium text-zinc-700">Recommendation</p>
              <p className="mt-1 text-zinc-600">{a.engagementRationale}</p>
              {a.draftContent && (
                <pre className="mt-1 whitespace-pre-wrap rounded bg-zinc-50 p-3 text-xs text-zinc-700">
                  {a.draftContent}
                </pre>
              )}
            </div>
          )}
        </div>
      </details>
    </div>
  );
}

function titleCase(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
