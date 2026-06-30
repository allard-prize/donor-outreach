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
4. Open a Pull Request — **ready for review, never a draft** — with a plain-English title and a description of *what changed and why*. (A draft hides the green Merge button and strands the operator.)
5. Vercel auto-deploys a **preview** for the PR and posts the preview URL as a PR comment.
6. **You cannot merge from your environment** (the cloud sandbox has no publish/merge connection). So hand the operator the PR link and the preview link; she reviews the preview and clicks the green **Merge** button herself to publish. Production redeploys automatically on merge.
7. If the preview looks wrong, she tells you in chat what to fix — revise on the same branch and push again; the same PR and preview update.

Branch protection blocks direct pushes to `main`, so a PR is the only path. That is the safety model: **every change passes through a preview before it reaches production.**

## Talking to the operator — plain language only (IMPORTANT)

The operator (Preet) is **non-technical**. Keep all the machinery (branches, commits, deploys, migrations) your concern — but there is **one** action only she can take: **you cannot publish from your environment.** The cloud sandbox has no publish/merge connection, so you can build and open a change but the final "make it live" click happens on GitHub. Your job is to do everything up to that click, then hand her the cleanest possible path.

- **Never use git/dev jargon with her.** Don't say "branch," "pull request / PR," "commit," "deploy," "production vs. preview," or "migration." Say: *"I've made the change,"* *"here's a link to preview it,"* *"open this and click the green button to publish it,"* *"it's now live,"* *"I've undone that."*
- **Open the change ready-to-publish, never a draft.** A draft hides the green Merge button and leaves her stuck. Always open the pull request ready for review.
- **Hand her two links in the chat:** the **preview link** (*"here's a preview of your change — nothing is live yet"*) and the **GitHub link** (*"when it looks good, open this and click the green ‘Merge’ button to make it live"*). Be explicit that clicking the green button is what publishes it.
- **You do NOT publish — she does.** You physically can't merge from here, so never say "I'll publish it for you" or claim "it's live" on your own say-so. After she clicks Merge, production redeploys automatically and she can confirm on the live site.
- **Revisions stay in chat.** If she says "change X," revise and send her fresh preview + publish links — don't tell her to comment on GitHub.
- **Undo is the same shape.** If she says "that's wrong / undo it," prepare the undo and give her the publish link to make it live.

Her model is: **ask → look at a preview → open the link and click the green button to publish.**

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
- Adding a new field/column (e.g. a prospect LinkedIn URL) — non-destructive schema changes now apply automatically via the preview→merge flow

**Ask a developer — do NOT change these without escalating in the PR:**
- Auth and the `ADMIN_ALLOWED_EMAILS` allowlist — `auth.ts`, `proxy.ts`
- Secrets, env vars, OAuth tokens, and the OpenRouter cost cap
- Microsoft Graph / SharePoint dossier auth — `lib/msgraph/`, the `app_token` store
- The cron schedule — `vercel.json` `crons`
- **Destructive schema migrations** — column/table drops or type narrowings always require escalation and a `-- DESTRUCTIVE` annotation. (Non-destructive schema changes like adding a column are now self-service via migrate-on-deploy — see the Database & migrations section.)

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
- **How migrations reach production — migrate-on-deploy (live):** migrations apply **automatically on deploy**. `vercel.json`'s `buildCommand` runs `pnpm db:migrate:deploy` (= `drizzle-kit migrate`) before the build, against the deploy's own database:
  - A PR's **preview** deploy applies the migration to its **own throwaway Neon preview branch** (auto-created by the Neon native integration, isolated from prod) — so the change can be reviewed on the preview before it goes live.
  - Merging to `main` applies it to **production** on the prod deploy.
  - So a schema change is **self-service**: edit `lib/db/schema.ts` → `pnpm db:generate` → open the PR → review the preview → merge. No manual `pnpm db:migrate` step against prod. (`pnpm db:migrate` with `.env.local` is still the way to apply migrations to prod by hand if ever needed.)

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
