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

**Status**: Phase 2B capture path complete (RSS + Gmail + LinkedIn). Next: Phase 2C decision path (agent + briefing send).

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
- **Eval rubric**: Preserved from Phase 1 — violation-count + 6-kind binary_check + JSON contract validator + string-similarity. Implementation lives at `lib/llm/judge.ts` (Phase 2E).

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
      # donor-outreach/, health-check/ — Phase 2C
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
  llm/                 # agent.ts + judge.ts (Phase 2C, 2E)
  email/               # send-briefing.ts (Phase 2C)
  dossiers/            # google-docs.ts (2C) + onedrive.ts (2G)
drizzle/
  migrations/          # drizzle-kit-generated SQL migrations
auth.ts                # Auth.js v5 config
proxy.ts               # /admin allowlist gate (Next.js 16 replaces middleware.ts)
drizzle.config.ts
vercel.json            # framework=nextjs + cron schedules
scripts/
  lint-destructive-migrations.mjs
```

## Cron handler invariants

- Auth: `Authorization: Bearer ${CRON_SECRET}` — required on every `/api/cron/*` request. Vercel Cron auto-attaches; manual hits need the env value.
- Vercel env-var changes do NOT trigger a redeploy — new env values only apply to NEW builds. After adding/rotating a cron-relevant env, push a commit (empty is fine) to force a rebuild.
- `runtime = "nodejs"` + `dynamic = "force-dynamic"` per handler.
- Handlers return JSON with `{ ok, durationMs, cronRunId, ...summary }` and 500 on caught errors.
- Every handler MUST call `recordRunStart(jobName)` immediately after auth check and `recordRunFinish(runId, outcome, opts)` in both success and catch paths. `lib/cron-runs/recorder.ts` provides both helpers. Outcome is `success` for clean runs, `partial` when the summary indicates per-item failures or timeouts, `failure` when the handler caught an exception.

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

**Last Updated**: 2026-05-22
