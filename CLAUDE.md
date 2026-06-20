@AGENTS.md

# Donor Outreach — Developer / Claude Code Notes

`AGENTS.md` (imported above) is the **canonical runbook** for any coding agent — architecture, commands, the maintenance loop, migration rules, invariants, and the safe-vs-escalate list. This file adds only developer-/Claude-Code-specific context for Brian's build sessions; keep agent-facing guidance in `AGENTS.md`, not here.

## Status

Phases 2A–2E + 2G complete. Eval harness in `main`; 2F migration run against prod Neon (44 prospects, 4218 results). Phase 2G done: 37 dossiers copied to the Allard SharePoint Context library; the reader (`lib/dossiers/onedrive.ts`) reads them via Graph + mammoth using a Postgres token store (`app_token`, `lib/msgraph/token-store.ts`) that survives serverless refresh-token rotation; 37 prospects repointed to `dossierProvider='onedrive'`. Remaining before the live cron arm: apply the 2E migration + seed eval cases + run the live eval proof, then the 2F cutover window with Preet.

**Phase 3 (handoff) in planning** — see `allard-prize-phase3-handoff-spec.md`. The conversational-maintenance tool is **OpenAI Codex** (Preet already has ChatGPT Plus). **Phase 3A hardens this repo for that handoff:** the `AGENTS.md` runbook (done), a `/admin/maintenance` launch page (done), branch protection on `main`, and migrate-on-deploy with a Neon preview branch (the T2 upgrade — see the Database & migrations section of `AGENTS.md`; until it lands, schema migrations are applied manually with `pnpm db:migrate`).

## No external Google dependency by design

Per Brian, the productionalized system holds all editable data in Postgres (UI-editable) and document files in Microsoft SharePoint/OneDrive (Phase 2G). No Google Sheet/Doc is a runtime dependency — eval cases live in `eval_case`, not the Phase 1 Eval sheet.

## Account identity

Vercel, Neon, OpenRouter, Apify, and GitHub are all bound to `allard.prize.alerts@gmail.com`. Brian operates these during Phase 2; ownership transfers to Allard at Phase 3.

## Developer discipline

Brian's `/specify` + `/tdd` discipline applies to **Brian's** development cycles, not Preet's ongoing maintenance (which is the conversational PR loop documented in `AGENTS.md`). Specs are the design-of-record in BrianPKM `3-Resources/` (`allard-prize-phase2-productionalization-spec.md`, `allard-prize-phase3-handoff-spec.md`).

**Last Updated**: 2026-06-20
