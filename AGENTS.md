<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Donor Outreach — Agent Runbook

This is the **canonical runbook for any AI coding agent** working on this repo (OpenAI Codex, GitHub Copilot, Google Jules, Cursor, Claude Code). It is written so a competent agent can make a correct, safe change from this file alone. `CLAUDE.md` imports this file (`@AGENTS.md`) and adds only developer-/Claude-specific notes on top — so this file stays the single source of truth.

## Who maintains this system

Allard Prize (**Preet**) — a non-technical operator — evolves this system by talking to an AI coding agent in plain English. Your job as that agent: turn her request into a small, correct change, **open a Pull Request**, and let Vercel preview-deploy it for her to review and merge. She does not write or read code.

Two hard invariants, always:
- **You never push directly to `main`.** Every change ships through a Pull Request.
- **The system never contacts a prospect.** Every outbound message is human-sent after manual review of an AI draft. Do not add auto-send.

Keep changes small and reviewable. When unsure whether a request is in scope, prefer the smallest change and state what you did.

## The maintenance loop (how every change ships)

1. Work on a branch — never commit to `main`.
2. Make the smallest change that satisfies the request.
3. Verify locally (see **Verify before every PR** below).
4. Open a Pull Request with a plain-English title and a description of *what changed and why*.
5. Vercel auto-deploys a **preview** for the PR and posts the preview URL as a PR comment. The operator reviews the change there.
6. On approval the PR is merged to `main`; production redeploys automatically.
7. If the preview looks wrong, the operator comments on the PR — revise on the same branch and push again.

Branch protection blocks direct pushes to `main`, so a PR is the only path. That is the safety model: **every change passes through a preview before it reaches production.**

## Talking to the operator — plain language only (IMPORTANT)

The operator (Preet) is **non-technical**. She must NOT need to understand branches, pull requests, merges, deploys, environments, previews, or migrations. The machinery above is real and matters — but it is **your** concern, never hers. Hide all of it:

- **Never use git/dev jargon with her.** Don't say "branch," "pull request / PR," "merge," "commit," "deploy," "production vs. preview," "environment," or "migration." Instead say: *"I've made the change,"* *"here's a link to preview it,"* *"want me to publish it?,"* *"it's now live,"* *"I've undone that."*
- **Do every mechanical step yourself.** You create the change, prepare the preview, and — once she approves — **publish it (merge to `main`) on her behalf.** She never opens GitHub and never clicks a merge button. Her only actions are: describe what she wants, glance at a preview link, and say "publish it" or "change X."
- **Hand her the preview link in the chat.** After you open the change, retrieve the preview URL (the deployment preview created for it) and paste it to her as *"here's a preview."* Do not send her to GitHub to hunt for it.
- **Publish on her plain-language approval.** When she says "looks good / publish it / go ahead," merge it; production updates automatically. Confirm in plain words: *"Done — it's live."*
- **Undo is plain too.** If she says "that's wrong / undo it," revert the change for her and confirm.

Her three-step model is: **ask → look at a preview → say "publish it."** Everything else is invisible.

## CRITICAL: Security

**NEVER commit secrets to git.** Real secrets live only in `.env` (git-ignored) locally and in the Vercel project env in production.

The repo is owned by `allard-prize-alerts` on GitHub and may be public at any time — **write code as if every file is world-readable from commit one.** No `.env*` committed, no API keys in fixtures or migrations, no real prospect names in tests.

## What you can safely change vs. what to escalate

**Safe — the bulk of maintenance (do these conversationally):**
- Briefing email wording, layout, or which fields show — `lib/email/render-briefing.ts`
- Admin UI: columns, labels, filters, sort order, copy — `app/admin/*`
- Threshold tuning (e.g. the priority-score alert cutoff)
- Adding or relabelling a `profileType` or `touchpointType` value
- Prompt refinements — `prompts/agent-*.md` (but run the prompt-change gate below)
- Adding a simple display field that already exists in the data

**Ask a developer — do NOT change these without escalating in the PR:**
- Auth and the `ADMIN_ALLOWED_EMAILS` allowlist — `auth.ts`, `proxy.ts`
- Secrets, env vars, OAuth tokens, and the OpenRouter cost cap
- Microsoft Graph / SharePoint dossier auth — `lib/msgraph/`, the `app_token` store
- The cron schedule — `vercel.json` `crons`
- **Database schema migrations** — see the Database & migrations section. Destructive ops always require escalation; and until migrate-on-deploy is wired, *any* schema change needs a developer to apply it to production.

## Tech stack

- Next.js 16 (App Router) + React 19 + TypeScript
- Tailwind CSS 4 (plain Tailwind RSC + server actions; shadcn/ui intentionally not installed)
- Auth.js v5 (`next-auth@beta`) — Google OAuth + email allowlist + database sessions
- Drizzle ORM + Neon Postgres (HTTP driver, edge-friendly)
- IDs: cuid2 (`lib/db/id.ts`)
- Vercel (Hobby tier under `allard.prize.alerts@gmail.com`) + Vercel Cron
- pnpm (`pnpm@10.x` — use pnpm, never npm/yarn)

```bash
pnpm dev                  # local dev (http://localhost:3000)
pnpm build                # production build
pnpm lint                 # eslint
pnpm lint:migrations      # destructive-migration annotation check
pnpm test                 # deterministic eval suite (contract + judge) — the CI gate
pnpm db:generate          # generate a SQL migration from schema.ts changes
pnpm db:migrate           # apply pending migrations to DATABASE_URL (manual, developer-run)
pnpm db:studio            # Drizzle Studio (local DB browser)
pnpm test:eval            # live LLM eval proof (spends tokens, needs .env.local)
```

## Verify before every PR

```bash
pnpm lint:migrations && pnpm lint && pnpm test && pnpm build
```

- `pnpm test` is the deterministic eval suite (contract validator + judge logic) and is the CI gate on every PR.
- **Prompt-change gate:** if you edit `prompts/agent-*.md`, additionally run `pnpm test:eval` (needs `.env.local`; spends OpenRouter tokens against the $25/mo cap) and confirm the violation counts hold before merging.

## Database & migrations (the danger zone — read before any schema change)

- Drizzle ORM + Neon Postgres. Schema is defined in `lib/db/schema.ts`; generated SQL migrations live in `drizzle/migrations/`.
- To change the schema: edit `lib/db/schema.ts`, then run `pnpm db:generate` to produce the migration SQL. **Never hand-edit generated migration SQL.**
- **Destructive ops** (`DROP TABLE`, `DROP COLUMN`, `ALTER COLUMN ... TYPE`, any type narrowing) **must have `-- DESTRUCTIVE` as the first line** of the migration `.sql` file. CI (`pnpm lint:migrations`) fails the build if an unannotated destructive op is present. Add the annotation by hand after `pnpm db:generate`, and call it out in the PR.
- **How migrations reach production (current state):** migrations are applied **manually** by a developer running `pnpm db:migrate` against the production database — they do **not** apply automatically on deploy yet. So if a request needs a schema change (e.g. "add a LinkedIn URL column"): generate the migration in your PR, **and state clearly in the PR description that a developer must run `pnpm db:migrate` after merge.** Treat schema changes as developer-assisted until the upgrade below lands.
- **Planned upgrade (Phase 3A T2):** migrate-on-deploy, with PR previews applying migrations to a throwaway Neon preview branch (so a schema change can be reviewed on the preview before it touches prod) and merges applying to prod automatically. When that is wired, this section is updated and schema changes become self-service.

## Project layout

```
app/
  admin/               # auth-gated admin UI (Phase 2D)
    layout.tsx         # admin nav
    prospects/  sources/  results/  assessments/  touchpoints/  briefings/  health/
    maintenance/       # "Make a change" launch page for the operator (Phase 3A)
  api/
    auth/[...nextauth]/route.ts
    cron/
      rss/route.ts             # daily 06:00 UTC — port of update-rss-results.json (2B)
      email-capture/route.ts   # daily 06:30 UTC — port of capture-ap-emails.json (2B)
      linkedin-scrape/route.ts # weekly Mon 00:00 UTC — port of capture-linkedin-posts.json (2B)
      donor-outreach/route.ts  # weekly Mon 02:00 UTC — port of ap-donor-outreach.json (2C)
lib/
  db/        index.ts (Drizzle+Neon client) · schema.ts (tables+enums) · id.ts (cuid2)
  gmail/     client.ts (Gmail OAuth2: read + label-modify)
  sources/   rss.ts · gmail.ts · linkedin.ts  (capture → result table, 2B)
  llm/
    agent.ts          # OpenRouter call + Zod-validated agent output (2C)
    aggregate.ts      # pending results → per-prospect payload
    donor-outreach.ts # orchestrator used by the cron handler
    prompts.ts        # loads prompts/agent-{system,user}-v1.md
    schema.ts         # agent output Zod schema + invariants (single enum source)
    contract.ts       # Phase 1 contract validator port (2E) — reuses schema.ts enums
    judge.ts          # deterministic eval judge: 6 binary checks + aggregation (2E)
    rubric-judge.ts   # Haiku 4.5 LLM rubric judge (2E)
    eval-cases.ts     # curated synthetic eval cases + reusable checks (2E)
    __tests__/        # Vitest unit suite for contract + judge (CI gate)
  email/     render-briefing.ts (Phase 1 HTML layout) · send-briefing.ts (Gmail send + briefings row)
  dossiers/  index.ts (provider dispatch) · google-docs.ts · onedrive.ts (SharePoint via MS Graph + mammoth)
  msgraph/   client.ts (Graph auth + shares/upload helpers, 2G)
  cron-runs/ recorder.ts (recordRunStart / recordRunFinish)
drizzle/migrations/    # drizzle-kit-generated SQL migrations
auth.ts                # Auth.js v5 config
proxy.ts               # /admin allowlist gate (Next.js 16 replaces middleware.ts)
drizzle.config.ts
vercel.json            # framework=nextjs + cron schedules
scripts/               # lint-destructive-migrations.mjs, seed/eval/migrate scripts
```

## Key invariants (preserve these when changing code)

### Cron handlers
- Auth: `Authorization: Bearer ${CRON_SECRET}` on every `/api/cron/*` request. Vercel Cron auto-attaches it; manual hits need the env value.
- Vercel env-var changes do NOT trigger a redeploy — new env values apply only to NEW builds. After adding/rotating a cron-relevant env, push a commit (an empty commit is fine) to force a rebuild.
- `runtime = "nodejs"` + `dynamic = "force-dynamic"` per handler. Handlers return JSON `{ ok, durationMs, cronRunId, ...summary }` and 500 on caught errors.
- Every handler MUST call `recordRunStart(jobName)` right after the auth check and `recordRunFinish(runId, outcome, opts)` in both success and catch paths (`lib/cron-runs/recorder.ts`). Outcome: `success` for clean runs, `partial` for per-item failures/timeouts, `failure` for a caught exception.

### Donor-outreach decision path (Phase 2C)
- Agent prompts live in `prompts/agent-system-v1.md` + `prompts/agent-user-v1.md`, ported verbatim from the Phase 1 n8n workflow. Template tokens: `{{RESULTS_JSON}}`, `{{CONTEXT}}`, `{{TOUCHPOINTS_JSON}}`, `{{FULL_NAME}}`. Substitution in `lib/llm/prompts.ts#renderUserPrompt`.
- Agent output is Zod-validated against `lib/llm/schema.ts`, enforcing the Phase 1 invariants: `priority_score ≤ 7 ⇒ touchpoint_type = no_action`; `no_action ⇒ draft_content = "No outreach recommended at this time."`; `priority_score ≥ 8 ⇒ draft_content ≥ 40 chars`; literal `Why now:` prefix on `engagement_rationale` when `touchpoint_type ≠ no_action`.
- One agent call per prospect with ≥1 `pending` result. `priority_score ≥ 8` (configurable via `runDonorOutreach({ alertThreshold })`) triggers a per-prospect briefing email; `< 8` records only `monitoring_results` (+ `touchpoints_potential` when applicable). A zero-alert weekly run still records a sentinel `briefings` row with `alertCount = 0`, so a missing weekly row signals a broken cron.
- `lib/email/render-briefing.ts` preserves the Phase 1 HTML layout (header, monitoring summary, key-alerts table, last-5 touchpoints, recommendation, draft, footer) — keep parity tight so Preet's reading habits transfer.
- All Phase 2C writes are idempotent: `monitoring_results.id` and `touchpoints_potential.id` are `${prospectId}_${runDate}` so a same-day re-run overwrites in place. `results.processedStatus` flips to `processed` after a successful persist.
- Cost log: per-call OpenRouter cost in `briefings.llmCostUsd` and `cron_runs.metadata.llmCostUsd`.

### Gmail capture
- Prospect-to-label mapping is by `prospects.fullName` (case-insensitive); the agent's Gmail must have a label whose name exactly matches each `emailEnabled` prospect's full name.
- Capture filter: messages currently in `INBOX` AND tagged with the prospect's label. `INBOX` is stripped after capture so the next run does not re-scan; the donor label stays for history. Dedup on `result.id` (Gmail message id).
- OAuth env: `GMAIL_OAUTH_CLIENT_ID/SECRET/REFRESH_TOKEN` for `allard.prize.alerts@gmail.com`. Scopes: `gmail.readonly` + `gmail.modify` (read+label) and `gmail.send` (briefing send).

### LinkedIn capture
- Eligible: `linkedInEnabled = true` AND `archivedAt IS NULL` AND `linkedInUrl IS NOT NULL`. URL parsed against `linkedin.com/in/<u>` or `linkedin.com/company/<u>`; unparseable URLs are skipped.
- Apify actors (verbatim from Phase 1): personal `LQQIXN9Othf8f7R5n`, company `mrThmKLmkxJPehxCg`, via `run-sync-get-dataset-items`. Wall-time budget 50 s shared across prospects; over-budget prospects are `prospectsTimedOut` and retried next day (21-day freshness window). Only posts within 21 days are inserted. Dedup on `result.id` = Apify `full_urn`. Env: `APIFY_API_TOKEN`.

### Eval harness (Phase 2E)
- **Deterministic** (`lib/llm/contract.ts` + `judge.ts`) runs in CI via `pnpm test` — free, fast, no LLM; the regression net for the rubric logic.
- **Live** (`pnpm test:eval`) runs cases through the real agent + Haiku rubric judge, writes an `eval_run` row, surfaced in `/admin/health`. Manual only (spends tokens, hits Postgres); NOT a CI gate. Eval cases are Postgres-resident (`eval_case`), no Google Sheet dependency.

## Specs & deeper context

- **Design-of-record:** `allard-prize-phase2-productionalization-spec.md` (the system) and `allard-prize-phase3-handoff-spec.md` (the maintenance handoff) in the owner's BrianPKM `3-Resources/`.
- **Operator's human guide:** the SharePoint `AP - Donor Outreach System` folder — `README.docx` (how the system works) and the maintenance guide (how to ask for a change). "SharePoint" always means that one folder: `allardprize2.sharepoint.com/sites/allardprize.org` → `Shared Documents/Shared Externally/AP - Donor Outreach System` (per-prospect dossiers in its `Context/` subfolder).
