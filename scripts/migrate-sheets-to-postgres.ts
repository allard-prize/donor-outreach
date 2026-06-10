/**
 * Phase 2F — one-shot Sheets → Postgres data migration.
 *
 * Reads the four Phase 1 Google Sheets and upserts them into the Neon
 * `prospect` / `source` / `result` / `touchpoint_assigned` tables. Idempotent:
 * every row upserts by primary key, so re-running produces zero net change.
 *
 * Reuses the agent's `GMAIL_OAUTH_*` OAuth client (same
 * `allard.prize.alerts@gmail.com` account that owns the sheets). The refresh
 * token must carry the `spreadsheets.readonly` scope (and `drive.readonly` for
 * dossier-id resolution) — add it via the OAuth playground the same way the
 * Docs scope was added for Phase 2C, if a 403/insufficientScopes surfaces.
 *
 * Usage:
 *   pnpm tsx --env-file=.env.local scripts/migrate-sheets-to-postgres.ts            # dry run (default)
 *   pnpm tsx --env-file=.env.local scripts/migrate-sheets-to-postgres.ts --commit   # write to Postgres
 *   pnpm tsx --env-file=.env.local scripts/migrate-sheets-to-postgres.ts --no-dossier  # skip Drive dossier lookup
 *
 * Dry run reads every sheet, validates + maps every row, and prints a
 * verification report (row counts, skip reasons, orphan-FK counts) WITHOUT
 * writing anything and WITHOUT printing prospect PII. `--commit` performs the
 * upserts in FK-dependency order. Rollback is truncate + re-import; data volume
 * is small enough that this is acceptable (per spec).
 */
import { sql } from "drizzle-orm";
import { google } from "googleapis";
import { db } from "@/lib/db";
import {
  prospects,
  sources,
  results,
  touchpointsAssigned,
} from "@/lib/db/schema";

// ---------- Source spreadsheets (each is its own spreadsheet, single tab) ----------

const SHEETS = {
  prospects: {
    spreadsheetId: "1-WyZV0aRWRQ6C8Cti3IU_VTznOIza-O7-w1H_K5zLj8",
    tab: "AP_Prospects_Master",
  },
  sources: {
    spreadsheetId: "120E6SrBGk0XT9HUC8d-kUwPhSoClaEK3gaZsHM4CVYk",
    tab: "RSS_Feeds",
  },
  results: {
    spreadsheetId: "10Zv3zgGDp2RUOXSd95jyj9K-IBXSZPrulzKqM9xs4GE",
    tab: "Sheet1",
  },
  touchpoints: {
    spreadsheetId: "1Ai5IUeaFcZAM8vBeK0xUgwAUdZeNGcyv4FndfA0jXAs",
    tab: "AP_Touchpoints_Assigned",
  },
} as const;

/** Google Drive folder holding per-prospect "Context" dossier Docs, matched by fullName. */
const CONTEXT_FOLDER_ID = "1HLZIrhjrgsY6i59PlYkJWiFf_1dVWODq";

// ---------- Enum normalization ----------

const PROFILE_TYPE_MAP: Record<string, string> = {
  "institutional funder": "institutional_funder",
  "individual donor": "individual_donor",
  connector: "connector",
  "credibility node": "credibility_node",
  collaborator: "collaborator",
};

const SOURCE_TYPE_MAP: Record<string, string> = {
  rss: "rss",
  google_alert: "rss", // Google Alerts are delivered as RSS feeds in Phase 1
  google_alerts: "rss",
  email: "email",
  linkedin: "linkedin_post",
  linkedin_post: "linkedin_post",
  linkedinpost: "linkedin_post",
  linkedin_posts: "linkedin_post",
};

// Historic touchpoint sheet uses a channel/shorthand vocab; map to the schema's
// recommendation enum where clear, else "other" (refine later in admin UI).
const TOUCHPOINT_TYPE_MAP: Record<string, string> = {
  meeting: "meeting_request",
  meeting_request: "meeting_request",
  intro: "introduction",
  introduction: "introduction",
  congratulations: "congratulations",
  collaboration: "collaboration",
  content_sharing: "content_sharing",
  invitation: "invitation",
  intermediary_engagement: "intermediary_engagement",
  follow_up: "follow_up",
  no_action: "no_action",
};

const PROCESSED_STATUSES = new Set(["pending", "processed"]);

// ---------- Generic helpers ----------

type Row = Record<string, string>;

interface SkipReason {
  reason: string;
  count: number;
}

class Reporter {
  skips = new Map<string, number>();
  notes = new Map<string, number>();
  errors: string[] = [];

  skip(reason: string) {
    this.skips.set(reason, (this.skips.get(reason) ?? 0) + 1);
  }

  /** A non-fatal data note — row is still migrated, but worth surfacing (e.g. defaulted field). */
  note(reason: string) {
    this.notes.set(reason, (this.notes.get(reason) ?? 0) + 1);
  }

  error(msg: string) {
    this.errors.push(msg);
  }

  skipList(): SkipReason[] {
    return [...this.skips.entries()].map(([reason, count]) => ({ reason, count }));
  }

  noteList(): SkipReason[] {
    return [...this.notes.entries()].map(([reason, count]) => ({ reason, count }));
  }
}

function parseBool(raw: string | undefined): boolean {
  const v = (raw ?? "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "y" || v === "x";
}

/**
 * Strip NUL and C0 control characters (except tab/newline/CR). Postgres `text`
 * rejects  outright, and scraped Google-Alert/LinkedIn content carries
 * stray control bytes — sanitize before insert.
 */
function clean(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    // keep tab(9), newline(10), CR(13); drop NUL and other C0 controls
    if (c >= 32 || c === 9 || c === 10 || c === 13) out += s[i];
  }
  return out;
}

function nullable(raw: string | undefined): string | null {
  const v = clean((raw ?? "").trim());
  return v.length > 0 ? v : null;
}

/** Parse a Phase 1 timestamp ("yyyy-MM-dd HH:mm:ss" or ISO-8601) to a Date, or null. */
function parseTimestamp(raw: string | undefined): Date | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  let d = new Date(v);
  if (isNaN(d.getTime())) d = new Date(v.replace(" ", "T"));
  return isNaN(d.getTime()) ? null : d;
}

/** Extract the YYYY-MM-DD date part for a `date`-typed column. */
function parseDateOnly(raw: string | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  const m = v.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** Stable content hash → deterministic id for keyless historic rows (idempotent re-import). */
function stableId(prefix: string, parts: (string | null)[]): string {
  const s = parts.map((p) => p ?? "").join("");
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return `${prefix}_${h.toString(36)}`;
}

/** Redact a name for transcript-safe logging — never print prospect PII. */
function redact(name: string | null | undefined): string {
  const v = (name ?? "").trim();
  return v ? `<name:${v.length}c>` : "<blank>";
}

// ---------- Google clients (reuse agent's Gmail OAuth) ----------

function getOAuthClient() {
  const clientId = process.env.GMAIL_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GMAIL_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_OAUTH_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Missing Google OAuth env: GMAIL_OAUTH_CLIENT_ID, GMAIL_OAUTH_CLIENT_SECRET, GMAIL_OAUTH_REFRESH_TOKEN"
    );
  }
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  return oauth2;
}

/** Read a sheet tab into header-keyed row objects (first row = headers). */
async function readSheet(spreadsheetId: string, tab: string): Promise<Row[]> {
  const sheets = google.sheets({ version: "v4", auth: getOAuthClient() });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tab}'`,
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });
  const values = (res.data.values ?? []) as unknown[][];
  if (values.length === 0) return [];
  const headers = values[0].map((h) => String(h ?? "").trim());
  return values.slice(1).map((arr) => {
    const row: Row = {};
    headers.forEach((h, i) => {
      row[h] = arr[i] === undefined || arr[i] === null ? "" : String(arr[i]);
    });
    return row;
  });
}

/** Resolve a prospect's Context dossier Google Doc id by fullName search in the Context folder. */
async function resolveDossierFileId(
  fullName: string,
  cache: Map<string, string | null>
): Promise<string | null> {
  if (cache.has(fullName)) return cache.get(fullName)!;
  const drive = google.drive({ version: "v3", auth: getOAuthClient() });
  const escaped = fullName.replace(/'/g, "\\'");
  const res = await drive.files.list({
    q: `'${CONTEXT_FOLDER_ID}' in parents and name contains '${escaped}' and mimeType = 'application/vnd.google-apps.document' and trashed = false`,
    fields: "files(id, name)",
    pageSize: 5,
  });
  const id = res.data.files?.[0]?.id ?? null;
  cache.set(fullName, id);
  return id;
}

// ---------- Mapping ----------

interface MappedData {
  prospects: (typeof prospects.$inferInsert)[];
  sources: (typeof sources.$inferInsert)[];
  results: (typeof results.$inferInsert)[];
  touchpoints: (typeof touchpointsAssigned.$inferInsert)[];
  validProspectIds: Set<string>;
}

async function mapProspects(
  rows: Row[],
  rep: Reporter,
  withDossier: boolean
): Promise<{ rows: (typeof prospects.$inferInsert)[]; ids: Set<string> }> {
  const out: (typeof prospects.$inferInsert)[] = [];
  const ids = new Set<string>();
  const dossierCache = new Map<string, string | null>();

  for (const r of rows) {
    const id = (r.prospectId ?? "").trim();
    const fullName = (r.fullName ?? "").trim();
    if (!id || !fullName) {
      rep.skip("prospect: missing prospectId or fullName");
      continue;
    }
    // The Phase 1 prospects sheet has no profileType column; default to "unknown"
    // (set real types later in the Phase 2D admin UI). A present-but-unmappable
    // value also defaults to "unknown" but is surfaced separately.
    const profileRaw = (r.profileType ?? "").trim().toLowerCase();
    const profileType = PROFILE_TYPE_MAP[profileRaw] ?? "unknown";
    if (profileRaw && !PROFILE_TYPE_MAP[profileRaw]) {
      rep.note(`prospect: unmapped profileType "${profileRaw}" → unknown`);
    } else if (!profileRaw) {
      rep.note("prospect: profileType blank → unknown");
    }

    let dossierProvider: "google_docs" | null = null;
    let dossierFileId: string | null = null;
    if (withDossier) {
      try {
        const fileId = await resolveDossierFileId(fullName, dossierCache);
        if (fileId) {
          dossierProvider = "google_docs";
          dossierFileId = fileId;
        } else {
          rep.skip("prospect: no Context dossier found (provider left null)");
        }
      } catch {
        rep.skip("prospect: dossier lookup failed (provider left null)");
      }
    }

    ids.add(id);
    out.push({
      id,
      fullName: clean(fullName),
      profileType: profileType as typeof prospects.$inferInsert.profileType,
      linkedInUrl: nullable(r.linkedInUrl),
      emailEnabled: parseBool(r.emailEnabled),
      linkedInEnabled: parseBool(r.linkedInEnabled),
      dossierProvider,
      dossierFileId,
    });
  }
  return { rows: out, ids };
}

function mapSources(
  rows: Row[],
  validProspectIds: Set<string>,
  rep: Reporter
): (typeof sources.$inferInsert)[] {
  const out: (typeof sources.$inferInsert)[] = [];
  for (const r of rows) {
    const id = (r.sourceId ?? "").trim();
    const prospectId = (r.prospectId ?? "").trim();
    const rssUrl = (r.rssUrl ?? "").trim();
    if (!rssUrl) {
      rep.skip("source: empty rssUrl");
      continue;
    }
    if (!id) {
      rep.skip("source: missing sourceId");
      continue;
    }
    if (!validProspectIds.has(prospectId)) {
      rep.skip("source: orphan prospectId (no matching prospect)");
      continue;
    }
    out.push({ id, prospectId, rssUrl: clean(rssUrl) });
  }
  return out;
}

function mapResults(
  rows: Row[],
  validProspectIds: Set<string>,
  validSourceIds: Set<string>,
  rep: Reporter
): (typeof results.$inferInsert)[] {
  const out: (typeof results.$inferInsert)[] = [];
  for (const r of rows) {
    const id = (r.resultId ?? "").trim();
    const prospectId = (r.prospectId ?? "").trim();
    if (!id) {
      rep.skip("result: missing resultId");
      continue;
    }
    if (!validProspectIds.has(prospectId)) {
      rep.skip("result: orphan prospectId");
      continue;
    }
    const sourceTypeRaw = (r.sourceType ?? "").trim().toLowerCase();
    const sourceType = SOURCE_TYPE_MAP[sourceTypeRaw];
    if (!sourceType) {
      rep.skip(`result: unmapped sourceType "${sourceTypeRaw || "(blank)"}"`);
      continue;
    }
    const pubDate = parseTimestamp(r.pubDate);
    if (!pubDate) {
      rep.skip("result: unparseable pubDate");
      continue;
    }
    // title is notNull in schema; Phase 1 has blank titles (esp. some alerts).
    // Preserve the row for parity by deriving from the snippet, else a sentinel.
    let title = (r.title ?? "").trim();
    if (!title) {
      title = (r.contentSnippet ?? "").trim().slice(0, 80) || "(untitled)";
      rep.note("result: blank title → derived from snippet/(untitled)");
    }
    let processedStatus = (r.processedStatus ?? "").trim().toLowerCase();
    if (!PROCESSED_STATUSES.has(processedStatus)) processedStatus = "pending";

    // sourceId is RSS-only and nullable; drop it if it doesn't resolve to a real source.
    const rawSourceId = (r.sourceId ?? "").trim();
    const sourceId = rawSourceId && validSourceIds.has(rawSourceId) ? rawSourceId : null;

    out.push({
      id,
      sourceId,
      prospectId,
      sourceType: sourceType as typeof results.$inferInsert.sourceType,
      title: clean(title),
      link: nullable(r.link),
      pubDate,
      contentSnippet: clean((r.contentSnippet ?? "").trim()),
      processedStatus: processedStatus as typeof results.$inferInsert.processedStatus,
    });
  }
  return out;
}

function mapTouchpoints(
  rows: Row[],
  validProspectIds: Set<string>,
  rep: Reporter
): (typeof touchpointsAssigned.$inferInsert)[] {
  const out: (typeof touchpointsAssigned.$inferInsert)[] = [];
  for (const r of rows) {
    const prospectId = (r.prospectId ?? "").trim();
    if (!validProspectIds.has(prospectId)) {
      rep.skip("touchpoint: orphan prospectId");
      continue;
    }
    const ttRaw = (r.touchpointType ?? "").trim().toLowerCase().replace(/\s+/g, "_");
    const touchpointType = TOUCHPOINT_TYPE_MAP[ttRaw] ?? "other";
    if (!TOUCHPOINT_TYPE_MAP[ttRaw]) {
      rep.note(`touchpoint: touchpointType "${ttRaw || "(blank)"}" → other`);
    }
    const completedDate = parseDateOnly(r.completedDate);
    if (!completedDate) {
      rep.skip("touchpoint: missing/unparseable completedDate");
      continue;
    }
    const summary = (r.summary ?? "").trim();
    const response = nullable(r.response);
    const nextStep = nullable(r.nextStep ?? r.notes);
    // Prefer the sheet's natural touchpointId key; fall back to a content hash.
    const tpId =
      (r.touchpointId ?? "").trim() ||
      stableId("tpa", [prospectId, completedDate, touchpointType, summary]);
    out.push({
      id: tpId,
      prospectId,
      touchpointType: touchpointType as typeof touchpointsAssigned.$inferInsert.touchpointType,
      completedDate,
      summary: clean(summary),
      response,
      nextStep,
    });
  }
  return out;
}

// ---------- Commit (FK-dependency order) ----------

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Dedupe rows by `id` (last wins). The Phase 1 sheets can contain repeat rows
 * sharing a primary key (e.g. the same alert captured twice); Postgres rejects
 * an INSERT … ON CONFLICT DO UPDATE that touches the same row twice in one
 * statement, so we collapse duplicates before upserting.
 */
function dedupeById<T extends { id?: string }>(rows: T[]): { rows: T[]; dropped: number } {
  const seen = new Map<string, T>();
  for (const r of rows) seen.set(String(r.id), r);
  return { rows: [...seen.values()], dropped: rows.length - seen.size };
}

/**
 * Upsert in chunks; on a chunk failure, fall back to row-by-row so good rows
 * still land and any genuinely-bad row is isolated and reported by id (covers
 * both a single offending row and an oversized-batch driver rejection).
 */
async function upsertResilient<T extends { id?: string }>(
  label: string,
  rows: T[],
  insert: (batch: T[]) => Promise<unknown>,
  rep: Reporter
): Promise<void> {
  const CHUNK = 100;
  let ok = 0;
  let failed = 0;
  let printed = 0;
  for (const c of chunk(rows, CHUNK)) {
    try {
      await insert(c);
      ok += c.length;
    } catch {
      for (const row of c) {
        try {
          await insert([row]);
          ok++;
        } catch (e) {
          failed++;
          if (printed++ < 10) {
            const msg = (e as { message?: string }).message ?? String(e);
            console.error(`    ${label} FAIL id=${row.id}: ${msg.slice(0, 90)}`);
          }
          rep.note(`${label}: row failed to upsert`);
        }
      }
    }
  }
  console.log(`  ${label}: ${ok} upserted${failed ? `, ${failed} FAILED` : ""}`);
}

async function commitAll(data: MappedData, rep: Reporter) {
  await upsertResilient(
    "prospects",
    data.prospects,
    (b) =>
      db.insert(prospects).values(b).onConflictDoUpdate({
        target: prospects.id,
        set: {
          fullName: sql`excluded.full_name`,
          profileType: sql`excluded.profile_type`,
          linkedInUrl: sql`excluded.linkedin_url`,
          emailEnabled: sql`excluded.email_enabled`,
          linkedInEnabled: sql`excluded.linkedin_enabled`,
          dossierProvider: sql`excluded.dossier_provider`,
          dossierFileId: sql`excluded.dossier_file_id`,
          updatedAt: sql`now()`,
        },
      }),
    rep
  );

  await upsertResilient(
    "sources",
    data.sources,
    (b) =>
      db.insert(sources).values(b).onConflictDoUpdate({
        target: sources.id,
        set: { prospectId: sql`excluded.prospect_id`, rssUrl: sql`excluded.rss_url` },
      }),
    rep
  );

  await upsertResilient(
    "touchpoints",
    data.touchpoints,
    (b) =>
      db.insert(touchpointsAssigned).values(b).onConflictDoUpdate({
        target: touchpointsAssigned.id,
        set: {
          touchpointType: sql`excluded.touchpoint_type`,
          completedDate: sql`excluded.completed_date`,
          summary: sql`excluded.summary`,
          response: sql`excluded.response`,
          nextStep: sql`excluded.next_step`,
        },
      }),
    rep
  );

  await upsertResilient(
    "results",
    data.results,
    (b) =>
      db.insert(results).values(b).onConflictDoUpdate({
        target: results.id,
        set: {
          sourceId: sql`excluded.source_id`,
          prospectId: sql`excluded.prospect_id`,
          sourceType: sql`excluded.source_type`,
          title: sql`excluded.title`,
          link: sql`excluded.link`,
          pubDate: sql`excluded.pub_date`,
          contentSnippet: sql`excluded.content_snippet`,
          processedStatus: sql`excluded.processed_status`,
        },
      }),
    rep
  );
}

// ---------- Main ----------

async function main() {
  const args = new Set(process.argv.slice(2));
  const commit = args.has("--commit");
  const withDossier = !args.has("--no-dossier");

  console.log(`\n=== Phase 2F: Sheets → Postgres (${commit ? "COMMIT" : "DRY RUN"}) ===`);
  console.log(`Dossier resolution: ${withDossier ? "on (Drive search by fullName)" : "off"}\n`);

  const rep = new Reporter();

  console.log("Reading sheets…");
  const [prospectRows, sourceRows, resultRows, touchpointRows] = await Promise.all([
    readSheet(SHEETS.prospects.spreadsheetId, SHEETS.prospects.tab),
    readSheet(SHEETS.sources.spreadsheetId, SHEETS.sources.tab),
    readSheet(SHEETS.results.spreadsheetId, SHEETS.results.tab),
    readSheet(SHEETS.touchpoints.spreadsheetId, SHEETS.touchpoints.tab),
  ]);
  console.log(
    `Raw rows — prospects:${prospectRows.length} sources:${sourceRows.length} ` +
      `results:${resultRows.length} touchpoints:${touchpointRows.length}\n`
  );
  console.log("Detected headers (column names only):");
  console.log(`  prospects:   ${JSON.stringify(Object.keys(prospectRows[0] ?? {}))}`);
  console.log(`  sources:     ${JSON.stringify(Object.keys(sourceRows[0] ?? {}))}`);
  console.log(`  results:     ${JSON.stringify(Object.keys(resultRows[0] ?? {}))}`);
  console.log(`  touchpoints: ${JSON.stringify(Object.keys(touchpointRows[0] ?? {}))}\n`);

  const { rows: mappedProspects, ids: validProspectIds } = await mapProspects(
    prospectRows,
    rep,
    withDossier
  );
  const mappedSources = mapSources(sourceRows, validProspectIds, rep);
  const validSourceIds = new Set(mappedSources.map((s) => s.id as string));
  const mappedResults = mapResults(resultRows, validProspectIds, validSourceIds, rep);
  const mappedTouchpoints = mapTouchpoints(touchpointRows, validProspectIds, rep);

  // Collapse duplicate primary keys before upsert (see dedupeById).
  const dedupProspects = dedupeById(mappedProspects);
  const dedupSources = dedupeById(mappedSources);
  const dedupResults = dedupeById(mappedResults);
  const dedupTouchpoints = dedupeById(mappedTouchpoints);
  for (const [name, d] of [
    ["prospects", dedupProspects],
    ["sources", dedupSources],
    ["results", dedupResults],
    ["touchpoints", dedupTouchpoints],
  ] as const) {
    if (d.dropped > 0) rep.note(`${name}: ${d.dropped} duplicate-id row(s) collapsed`);
  }

  const data: MappedData = {
    prospects: dedupProspects.rows,
    sources: dedupSources.rows,
    results: dedupResults.rows,
    touchpoints: dedupTouchpoints.rows,
    validProspectIds,
  };

  console.log("Mapped (ready to upsert):");
  console.log(`  prospects:    ${data.prospects.length}`);
  console.log(`  sources:      ${data.sources.length}`);
  console.log(`  results:      ${data.results.length}`);
  console.log(`  touchpoints:  ${data.touchpoints.length}`);

  const withDossierCount = data.prospects.filter((p) => p.dossierFileId).length;
  console.log(`  (prospects with resolved dossier: ${withDossierCount}/${data.prospects.length})`);

  const skips = rep.skipList();
  if (skips.length) {
    console.log("\nSkipped rows (reason → count):");
    for (const { reason, count } of skips.sort((a, b) => b.count - a.count)) {
      console.log(`  ${count.toString().padStart(4)}  ${reason}`);
    }
  } else {
    console.log("\nNo rows skipped.");
  }

  const notes = rep.noteList();
  if (notes.length) {
    console.log("\nData notes (row migrated, field adjusted → count):");
    for (const { reason, count } of notes.sort((a, b) => b.count - a.count)) {
      console.log(`  ${count.toString().padStart(4)}  ${reason}`);
    }
  }

  // Transcript-safe sample (no PII)
  if (mappedProspects.length) {
    const s = mappedProspects[0];
    console.log("\nSample prospect (redacted):");
    console.log(
      `  id=${s.id} name=${redact(s.fullName)} profileType=${s.profileType} ` +
        `email=${s.emailEnabled} linkedin=${s.linkedInEnabled} dossier=${s.dossierProvider ?? "none"}`
    );
  }

  if (rep.errors.length) {
    console.log("\nErrors:");
    for (const e of rep.errors) console.log(`  ! ${e}`);
  }

  if (!commit) {
    console.log("\nDRY RUN — nothing written. Re-run with --commit to upsert.\n");
    return;
  }

  console.log("\nCommitting (prospects → sources → touchpoints → results)…");
  await commitAll(data, rep);
  console.log("Commit complete. Re-run to verify idempotency (counts should be unchanged).\n");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    const e = err as Record<string, unknown> & { message?: string };
    console.error("\nMIGRATION FAILED:", (e.message ?? String(err)).slice(0, 300));
    // Surface Postgres/Neon error metadata without dumping the (huge) query/params.
    const skip = new Set(["message", "query", "params", "stack"]);
    for (const k of Object.getOwnPropertyNames(e)) {
      if (skip.has(k)) continue;
      const v = e[k];
      if (v != null && typeof v !== "object") console.error(`  ${k}: ${String(v).slice(0, 200)}`);
    }
    process.exit(1);
  });
