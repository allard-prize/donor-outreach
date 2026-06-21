// "Make a change" — the operator's launch pad for conversational maintenance
// (Phase 3A). This page does not edit anything itself; it points the operator at
// their AI coding assistant (OpenAI Codex) and at the places they review and
// merge the change. The assistant opens a Pull Request; Vercel preview-deploys
// it; the operator reviews the preview and merges. See AGENTS.md for the agent
// side of the same loop.

const CODEX_URL = "https://chatgpt.com/codex";
const SHAREPOINT_FOLDER =
  "https://allardprize2.sharepoint.com/:f:/r/sites/allardprize.org/Shared%20Documents/Shared%20Externally/AP%20-%20Donor%20Outreach%20System?csf=1&web=1&e=wz8n2w";
const README_URL =
  "https://allardprize2.sharepoint.com/:w:/r/sites/allardprize.org/Shared%20Documents/Shared%20Externally/AP%20-%20Donor%20Outreach%20System/README.docx?d=w2cd825567af14d73aa6885bd95027554&csf=1&web=1&e=CYcFom";

const STEPS = [
  {
    n: 1,
    title: "Ask for the change",
    body: "Open ChatGPT and describe what you want in plain English — for example, “Add the priority score to the briefing email.” It makes the change and sends you back a link to preview it.",
  },
  {
    n: 2,
    title: "Look at the preview",
    body: "Open the link it gives you — it's a private copy of the site with your change applied. Check that it looks right. Nothing is live yet.",
  },
  {
    n: 3,
    title: "Publish (or adjust)",
    body: "Happy with it? Reply “publish it” and ChatGPT makes it live for you. Not quite right? Tell it what to change. Changed your mind later? Just say “undo that.”",
  },
];

const SAFE = [
  "Wording and layout of the weekly briefing email",
  "Dashboard labels, columns, filters, and ordering",
  "The priority-score cutoff that triggers an alert",
  "Adding or renaming a prospect type or touchpoint type",
];

const ASK_BRIAN = [
  "Who can sign in (the access list)",
  "Passwords, keys, and the monthly spend cap",
  "The schedule the system runs on",
  "Anything that adds or removes a database column (for now)",
];

function ExternalLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-sm text-blue-600 hover:underline"
    >
      {children}
    </a>
  );
}

export default function MaintenancePage() {
  return (
    <main>
      <h1 className="text-xl font-semibold">Make a change</h1>
      <p className="mt-2 max-w-2xl text-sm text-zinc-600">
        You can evolve this system by talking to your AI assistant — no code, no
        developer. Describe what you want, review a preview, and approve it. Here
        is the whole loop:
      </p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {STEPS.map((s) => (
          <div
            key={s.n}
            className="rounded-lg border border-zinc-200 bg-white p-4"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white">
              {s.n}
            </span>
            <p className="mt-3 text-sm font-semibold">{s.title}</p>
            <p className="mt-1 text-sm text-zinc-600">{s.body}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <a
          href={CODEX_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          Open ChatGPT to make a change
        </a>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <p className="text-sm font-semibold text-zinc-700">
            Things you can ask for
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-600">
            {SAFE.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <p className="text-sm font-semibold text-zinc-700">
            Check with Brian first
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-600">
            {ASK_BRIAN.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      </div>

      <p className="mt-6 text-sm text-zinc-500">
        Full guide:{" "}
        <ExternalLink href={README_URL}>System README</ExternalLink>
        {"  ·  "}
        <ExternalLink href={SHAREPOINT_FOLDER}>
          Documents folder (SharePoint)
        </ExternalLink>
      </p>
    </main>
  );
}
