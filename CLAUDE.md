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

**Status**: Phase 2A scaffold in progress. Next: Phase 2B capture path.

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
    cron/              # Vercel Cron handlers (Phase 2B+)
lib/
  db/
    index.ts           # Drizzle + Neon HTTP client
    schema.ts          # table + enum definitions
    id.ts              # cuid2 generator
  llm/                 # agent.ts + judge.ts (Phase 2C, 2E)
  email/               # send-briefing.ts (Phase 2C)
  sources/             # rss.ts, gmail.ts, linkedin.ts (Phase 2B)
  dossiers/            # google-docs.ts (2C) + onedrive.ts (2G)
drizzle/
  migrations/          # drizzle-kit-generated SQL migrations
auth.ts                # Auth.js v5 config
proxy.ts               # /admin allowlist gate (Next.js 16 replaces middleware.ts with proxy.ts)
drizzle.config.ts
scripts/
  lint-destructive-migrations.mjs
```

---

**Last Updated**: 2026-05-21
