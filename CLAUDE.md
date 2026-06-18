@AGENTS.md

# Donor Outreach — Claude Code Guide

## CRITICAL: Security

**NEVER commit secrets to git.** Real secrets only in `.env` (git-ignored) locally, Vercel project env in prod. Reference: @/home/brian/SECURITY.md

The repo is owned by `allard-prize-alerts` on GitHub and may be public at any time — write code as if every file is world-readable from commit one. No `.env*` committed, no API keys in fixtures or migrations, no real prospect names in tests.

---

## Project Context

**Purpose**: Phase 2 productionalization of the Allard Prize donor outreach system. Ports the Phase 1 n8n + Sheets + Docs prototype to Next.js + Postgres so Allard Prize can operate and evolve the system without MAS in the loop.

**Spec (design-of-record)**: `~/gdrive-brianpkm/3-Resources/allard-prize-phase2-productionalization-spec.md`
**Phase 1 reference**: `~/gdrive-brianpkm/3-Resources/allard-prize-donor-outreach-spec.md` (reverse-engineered from n8n JSON at `~/workspace/workflows/allard-prize/ap-donor-outreach/`)
**Project tracker**: `~/gdrive-brianpkm/1-Projects/Allard Prize Donor Outreach System.md`

**Status**: Phases 2A–2E code-complete (eval harness in `main`); 2F migration run against prod Neon (44 prospects, 4218 results). Phase 2G dossier code is built: all 37 dossiers copied from the source Google Drive folder to the Allard SharePoint Context library (Doc→`.docx`), and `lib/dossiers/onedrive.ts` reads them back via Graph + mammoth (verified). Remaining before live cron arm: (1) the SharePoint **repoint** cutover (`scripts/migrate-dossiers-to-sharepoint.ts --repoint --commit` — dry-run matches 37/37) once the serverless Graph-token story is settled (app-only `Sites.Selected` grant, preferred, or a Postgres token store), (2) apply the 2E migration + seed eval cases + run the live eval proof, (3) the 2F cutover window with Preet.

**No external Google dependency by design**: per Brian, the productionalized system holds all editable data in Postgres (UI-editable) and document files in Microsoft SharePoint/OneDrive (Phase 2G). No Google Sheet/Doc is a runtime dependency — eval cases live in the `eval_case` table, not the Phase 1 Eval sheet.

---

## Tech Stack

- Next.js 16 (App Router) + React 19 + TypeScript
- Tailwind CSS 4
- Auth.js v5 (`next-auth@beta`) with Google OAuth + email allowlist + database sessions
- Drizzle ORM + Neon Postgres (HTTP driver, edge-friendly)
- IDs: cuid2 (`lib/db/id.ts`)
- Vercel (Hobby tier under `allard.prize.alerts@gmail.com`) + Vercel Cron
- pnpm

```bash
pnpm dev                  # local dev (http://localhost:3000)
pnpm build                # production build
pnpm lint                 # eslint
pnpm lint:migrations      # destructive-migration annotation check
pnpm db:generate          # generate SQL migration from schema changes
pnpm db:migrate           # apply pending migrations to DATABASE_URL
pnpm db:studio            # Drizzle Studio (local DB browser)
```

---

## Conventions

- **Account identity**: Vercel, Neon, OpenRouter, Apify, GitHub all bound to `allard.prize.alerts@gmail.com`. Brian operates these during Phase 2; ownership transfers to Allard at Phase 3.
- **Destructive migrations**: Any drizzle-kit-generated SQL containing `DROP TABLE`, `DROP COLUMN`, `ALTER COLUMN ... TYPE`, etc. must have `-- DESTRUCTIVE` as the first line of the migration `.sql` file. CI rejects unannotated destructives. Add the annotation by hand after running `pnpm db:generate`.
- **Auth allowlist**: `ADMIN_ALLOWED_EMAILS` is a comma-separated lowercased email list. Sign-in is blocked for anything not on the list — no public signup.
- **Cost cap**: OpenRouter spend cap is `$25/mo` — enforced at the OpenRouter dashboard level. Per-call cost is logged to `cron_runs.llm_cost_usd` so runaway loops surface in `/admin/health` within hours.
- **Eval rubric**: Preserved from the Phase 1 C.2 harness — per-case violation count = failed binary checks + contract violation (0/1) + LLM rubric-judge violations. The 6 binary-check kinds (regex, schema, enum-membership, invariant, rule-table, cross-reference) live in `lib/llm/judge.ts`; the contract validator in `lib/llm/contract.ts`; the Haiku rubric judge in `lib/llm/rubric-judge.ts`. String-similarity was a C.1 holdover and is intentionally not ported (the C.2 harness replaced it with the rubric judge).

---

## Layout

```
app/
  admin/               # auth-gated admin UI (Phase 2D)
  api/
    auth/[...nextauth]/route.ts
    cron/
      rss/route.ts             # daily 06:00 UTC — port of update-rss-results.json (Phase 2B)
      email-capture/route.ts   # daily 06:30 UTC — port of capture-ap-emails.json (Phase 2B)
      linkedin-scrape/route.ts # Mondays 23:00 UTC — port of capture-linkedin-posts.json (Phase 2B)
      donor-outreach/route.ts  # Tuesdays 09:00 UTC — port of ap-donor-outreach.json (Phase 2C)
      # health-check/ — TBD (Phase 2C/2D)
lib/
  db/
    index.ts           # Drizzle + Neon HTTP client
    schema.ts          # table + enum definitions
    id.ts              # cuid2 generator
  gmail/
    client.ts          # Gmail API OAuth2 client (read + label-modify)
  sources/
    rss.ts             # RSS parser → result table (Phase 2B done)
    gmail.ts           # Gmail label-based capture → result table (Phase 2B done)
    linkedin.ts        # Apify-driven LinkedIn post scrape → result table (Phase 2B done)
  llm/
    agent.ts                 # OpenRouter call + Zod-validated agent output (2C)
    aggregate.ts             # pending-results → per-prospect payload (Clean Results port)
    donor-outreach.ts        # orchestrator used by the cron handler
    prompts.ts               # loads prompts/agent-{system,user}-v1.md
    schema.ts                # agent output Zod schema + invariants (single enum source)
    contract.ts              # Phase 1 contract validator port (2E) — reuses schema.ts enums
    judge.ts                 # deterministic eval judge: 6 binary checks + aggregation (2E)
    rubric-judge.ts          # Haiku 4.5 LLM rubric judge (2E)
    eval-cases.ts            # curated synthetic eval cases + reusable checks (2E)
    __tests__/               # Vitest unit suite for contract + judge (CI gate)
  email/
    render-briefing.ts       # per-prospect HTML — preserves Phase 1 layout byte-for-byte
    send-briefing.ts         # Gmail send + briefings row insert (2C)
  dossiers/
    index.ts                 # dossierProvider dispatcher (google_docs + onedrive)
    google-docs.ts           # Docs API read (2C; retire after the SharePoint repoint cutover)
    onedrive.ts              # SharePoint dossier read via MS Graph + mammoth (2G)
  msgraph/
    client.ts                # Graph auth (B2B-guest refresh token) + shares/upload helpers (2G)
drizzle/
  migrations/          # drizzle-kit-generated SQL migrations
auth.ts                # Auth.js v5 config
proxy.ts               # /admin allowlist gate (Next.js 16 replaces middleware.ts)
drizzle.config.ts
vercel.json            # framework=nextjs + cron schedules
scripts/
  lint-destructive-migrations.mjs
  migrate-dossiers-to-sharepoint.ts  # 2G: Drive→SharePoint copy (Doc→docx), --probe/--read/--repoint
  seed-eval-cases.ts         # curated cases → eval_case table (2E)
  run-eval.ts                # live eval proof tool → eval_run row (2E)
```

## Eval harness (Phase 2E)

Ports the Phase 1 n8n C.2 harness to Postgres + Vitest. Two layers:

- **Deterministic** (`lib/llm/contract.ts` + `judge.ts`) — runs in CI via `pnpm test` on every PR. Free, fast, no LLM. This is the regression net for the rubric logic.
- **Live** (`pnpm test:eval`) — runs cases through the agent (real OpenRouter) + the Haiku rubric judge, writes an `eval_run` row, surfaced in `/admin/health`. Manual only (spends tokens, hits Postgres); NOT a CI gate — running the full historical set in CI is cost-prohibitive vs the $25/mo cap.

```bash
pnpm test                 # deterministic eval suite (CI gate)
pnpm db:migrate           # apply the eval_case / eval_run tables
pnpm seed:eval-cases      # load curated cases into eval_case
pnpm test:eval            # live eval proof (default model)
pnpm test:eval --model anthropic/claude-sonnet-4.6 --limit 2 --max-cost 1
```

**Proof gate**: run `pnpm test:eval` on the v1 prompt, then on a model swap, and confirm the violation counts hold. Eval cases are Postgres-resident (`eval_case`, UI-editable later) — no Google Sheet dependency.

## Cron handler invariants

- Auth: `Authorization: Bearer ${CRON_SECRET}` — required on every `/api/cron/*` request. Vercel Cron auto-attaches; manual hits need the env value.
- Vercel env-var changes do NOT trigger a redeploy — new env values only apply to NEW builds. After adding/rotating a cron-relevant env, push a commit (empty is fine) to force a rebuild.
- `runtime = "nodejs"` + `dynamic = "force-dynamic"` per handler.
- Handlers return JSON with `{ ok, durationMs, cronRunId, ...summary }` and 500 on caught errors.
- Every handler MUST call `recordRunStart(jobName)` immediately after auth check and `recordRunFinish(runId, outcome, opts)` in both success and catch paths. `lib/cron-runs/recorder.ts` provides both helpers. Outcome is `success` for clean runs, `partial` when the summary indicates per-item failures or timeouts, `failure` when the handler caught an exception.

## Donor-outreach decision path invariants (Phase 2C)

- Agent prompts live in `prompts/agent-system-v1.md` + `prompts/agent-user-v1.md` — ported verbatim from the Phase 1 n8n workflow. Template tokens: `{{RESULTS_JSON}}`, `{{CONTEXT}}`, `{{TOUCHPOINTS_JSON}}`, `{{FULL_NAME}}`. Substitution lives in `lib/llm/prompts.ts#renderUserPrompt`.
- Agent output is parsed + Zod-validated against `lib/llm/schema.ts`. Validation enforces the Phase 1 invariants: `priority_score ≤ 7 ⇒ touchpoint_type = no_action`, `no_action ⇒ draft_content = "No outreach recommended at this time."`, `priority_score ≥ 8 ⇒ draft_content ≥ 40 chars`, and the literal `Why now:` prefix on `engagement_rationale` when `touchpoint_type ≠ no_action`.
- One agent call per prospect with at least one `pending` result. `priority_score ≥ 8` (configurable via `runDonorOutreach({ alertThreshold })`) triggers a per-prospect briefing email; `< 8` records only `monitoring_results` + (when applicable) `touchpoints_potential`. A weekly run with zero alerts records a sentinel `briefings` row with `alertCount = 0` so absence of a Tuesday row signals a broken cron.
- `lib/email/render-briefing.ts` preserves the Phase 1 HTML layout (header, monitoring summary, key alerts table, last-5 touchpoints table, recommendation, draft, generated-at footer) — keep parity tight so Preet's reading habits transfer.
- All Phase 2C writes are idempotent: `monitoring_results.id` and `touchpoints_potential.id` are `${prospectId}_${runDate}` so a re-run of the same Tuesday overwrites in place. `results.processedStatus` flips to `processed` after a successful per-prospect persist; re-runs naturally pull zero pending and exit clean.
- Cost log: per-call OpenRouter cost reported in `briefings.llmCostUsd` (sum per briefing row) and surfaced in the `donor_outreach` `cron_runs.metadata.llmCostUsd`.

## Fixture smoke test

`scripts/smoke-donor-outreach.ts` seeds a synthetic prospect + two pending results, runs `runDonorOutreach` with a stubbed agent (no OpenRouter spend) and stubbed dossier (no Docs read), asserts persistence, then tears the fixture down. Briefings/cron_runs rows are intentionally left for observability.

```bash
pnpm tsx --env-file=.env.local scripts/smoke-donor-outreach.ts
```

Exits non-zero on any assertion miss. Safe against `.env.local` (Neon prod) because all fixture row ids are prefixed `smoke_phase2c_<timestamp>` and deleted in teardown.

## Gmail capture invariants

- Prospect-to-label mapping is by `prospects.fullName` (case-insensitive). The agent's Gmail must have a label whose name exactly matches each `emailEnabled` prospect's full name.
- Capture filter: messages currently in `INBOX` AND tagged with the prospect's label. The `INBOX` label is stripped after capture so the next day's run does not re-scan the same message. The donor label stays for historical reference.
- Dedup is enforced in Postgres on `result.id` (Gmail message id). Re-adding `INBOX` to a stripped message will re-scan and the insert will no-op.
- OAuth env (shared with the briefing-send path in Phase 2C): `GMAIL_OAUTH_CLIENT_ID`, `GMAIL_OAUTH_CLIENT_SECRET`, `GMAIL_OAUTH_REFRESH_TOKEN` — for `allard.prize.alerts@gmail.com`. Required scopes: `gmail.readonly` + `gmail.modify` for the read+label-removal path, `gmail.send` for Phase 2C briefing send.

## LinkedIn capture invariants

- Eligible prospects: `linkedInEnabled = true` AND `archivedAt IS NULL` AND `linkedInUrl IS NOT NULL`. URL is parsed by regex against `linkedin.com/in/<u>` (personal) or `linkedin.com/company/<u>` (company); unparseable URLs are silently skipped.
- Apify actors (verbatim from Phase 1 n8n): personal posts `LQQIXN9Othf8f7R5n`, company posts `mrThmKLmkxJPehxCg`. Both called via `run-sync-get-dataset-items` so one HTTP call per prospect returns the dataset items.
- Wall-time budget: total **50 s** shared across all prospects via a single deadline; per-call Apify `timeout` capped at 50 s. Any prospects whose runs would exceed the budget are counted as `prospectsTimedOut` and retried on the next day's cron — acceptable because LinkedIn posts have a 21-day freshness window.
- Filter: only posts with `posted_at.date` within the last 21 days are inserted. Dedup is enforced in Postgres on `result.id` = Apify `full_urn`.
- Env: `APIFY_API_TOKEN` (passed as `Authorization: Bearer …` on every Apify call).

---

**Last Updated**: 2026-06-18
