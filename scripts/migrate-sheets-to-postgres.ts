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
  email: "email",
  linkedin: "linkedin_post",
  linkedin_post: "linkedin_post",
  linkedinpost: "linkedin_post",
  linkedin_posts: "linkedin_post",
};

const TOUCHPOINT_TYPES = new Set([
  "congratulations",
  "collaboration",
  "content_sharing",
  "introduction",
  "meeting_request",
  "invitation",
  "intermediary_engagement",
  "follow_up",
  "no_action",
]);

const PROCESSED_STATUSES = new Set(["pending", "processed"]);

// ---------- Generic helpers ----------

type Row = Record<string, string>;

interface SkipReason {
  reason: string;
  count: number;
}

class Reporter {
  skips = new Map<string, number>();
  errors: string[] = [];

  skip(reason: string) {
    this.skips.set(reason, (this.skips.get(reason) ?? 0) + 1);
  }

  error(msg: string) {
    this.errors.push(msg);
  }

  skipList(): SkipReason[] {
    return [...this.skips.entries()].map(([reason, count]) => ({ reason, count }));
  }
}

function parseBool(raw: string | undefined): boolean {
  const v = (raw ?? "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "y" || v === "x";
}

function nullable(raw: string | undefined): string | null {
  const v = (raw ?? "").trim();
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
  const s = parts.map((p) => p ?? "").join("");
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
    const profileRaw = (r.profileType ?? "").trim().toLowerCase();
    const profileType = PROFILE_TYPE_MAP[profileRaw];
    if (!profileType) {
      rep.skip(`prospect: unmapped profileType "${profileRaw || "(blank)"}"`);
      continue;
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
      fullName,
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
    out.push({ id, prospectId, rssUrl });
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
    const title = (r.title ?? "").trim();
    if (!title) {
      rep.skip("result: missing title");
      continue;
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
      title,
      link: nullable(r.link),
      pubDate,
      contentSnippet: (r.contentSnippet ?? "").trim(),
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
    const touchpointType = TOUCHPOINT_TYPES.has(ttRaw) ? ttRaw : null;
    if (!touchpointType) {
      rep.skip(`touchpoint: unmapped touchpointType "${ttRaw || "(blank)"}"`);
      continue;
    }
    const completedDate = parseDateOnly(r.completedDate);
    if (!completedDate) {
      rep.skip("touchpoint: missing/unparseable completedDate");
      continue;
    }
    const summary = (r.summary ?? "").trim();
    const response = nullable(r.response);
    const nextStep = nullable(r.nextStep ?? r.notes);
    out.push({
      id: stableId("tpa", [prospectId, completedDate, touchpointType, summary]),
      prospectId,
      touchpointType: touchpointType as typeof touchpointsAssigned.$inferInsert.touchpointType,
      completedDate,
      summary,
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

async function commitAll(data: MappedData) {
  const CHUNK = 200;

  for (const c of chunk(data.prospects, CHUNK)) {
    await db
      .insert(prospects)
      .values(c)
      .onConflictDoUpdate({
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
      });
  }

  for (const c of chunk(data.sources, CHUNK)) {
    await db
      .insert(sources)
      .values(c)
      .onConflictDoUpdate({
        target: sources.id,
        set: { prospectId: sql`excluded.prospect_id`, rssUrl: sql`excluded.rss_url` },
      });
  }

  for (const c of chunk(data.touchpoints, CHUNK)) {
    await db
      .insert(touchpointsAssigned)
      .values(c)
      .onConflictDoUpdate({
        target: touchpointsAssigned.id,
        set: {
          touchpointType: sql`excluded.touchpoint_type`,
          completedDate: sql`excluded.completed_date`,
          summary: sql`excluded.summary`,
          response: sql`excluded.response`,
          nextStep: sql`excluded.next_step`,
        },
      });
  }

  for (const c of chunk(data.results, CHUNK)) {
    await db
      .insert(results)
      .values(c)
      .onConflictDoUpdate({
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
      });
  }
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

  const { rows: mappedProspects, ids: validProspectIds } = await mapProspects(
    prospectRows,
    rep,
    withDossier
  );
  const mappedSources = mapSources(sourceRows, validProspectIds, rep);
  const validSourceIds = new Set(mappedSources.map((s) => s.id as string));
  const mappedResults = mapResults(resultRows, validProspectIds, validSourceIds, rep);
  const mappedTouchpoints = mapTouchpoints(touchpointRows, validProspectIds, rep);

  const data: MappedData = {
    prospects: mappedProspects,
    sources: mappedSources,
    results: mappedResults,
    touchpoints: mappedTouchpoints,
    validProspectIds,
  };

  console.log("Mapped (ready to upsert):");
  console.log(`  prospects:    ${mappedProspects.length}`);
  console.log(`  sources:      ${mappedSources.length}`);
  console.log(`  results:      ${mappedResults.length}`);
  console.log(`  touchpoints:  ${mappedTouchpoints.length}`);

  const withDossierCount = mappedProspects.filter((p) => p.dossierFileId).length;
  console.log(`  (prospects with resolved dossier: ${withDossierCount}/${mappedProspects.length})`);

  const skips = rep.skipList();
  if (skips.length) {
    console.log("\nSkipped rows (reason → count):");
    for (const { reason, count } of skips.sort((a, b) => b.count - a.count)) {
      console.log(`  ${count.toString().padStart(4)}  ${reason}`);
    }
  } else {
    console.log("\nNo rows skipped.");
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
  await commitAll(data);
  console.log("Commit complete. Re-run to verify idempotency (counts should be unchanged).\n");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nMIGRATION FAILED:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
