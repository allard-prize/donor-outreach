/**
 * Phase 2G — copy dossier files from the Google Drive source folder into the
 * Allard SharePoint "Context" folder, converting Google Docs to Word (.docx).
 *
 * Source (Google Drive folder): DRIVE_SOURCE_FOLDER_ID below — read with the
 *   agent's GMAIL_OAUTH_* token (has drive.readonly from Phase 2F).
 * Dest (SharePoint folder): SHAREPOINT_FOLDER_URL below — written via Graph
 *   with the ONEDRIVE_OAUTH_* (B2B guest) token. Resolved via the shares API,
 *   falling back to site/path navigation.
 *
 * The Graph refresh token ROTATES on every redemption (probe or real) — this
 * script persists the new one back to .env.local so the stored token stays valid.
 *
 * Usage:
 *   pnpm tsx --env-file=.env.local scripts/migrate-dossiers-to-sharepoint.ts --probe
 *       # resolve + list both sides, NO uploads (auth + addressing check)
 *   pnpm tsx --env-file=.env.local scripts/migrate-dossiers-to-sharepoint.ts
 *       # the real copy
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Buffer } from "node:buffer";
import { google } from "googleapis";
import {
  getGraphToken,
  graphFetch,
  listChildren,
  resolveSharedItem,
  uploadFile,
  type DriveItem,
} from "@/lib/msgraph/client";

const DRIVE_SOURCE_FOLDER_ID = "1HLZIrhjrgsY6i59PlYkJWiFf_1dVWODq";
const SHAREPOINT_FOLDER_URL =
  "https://allardprize2.sharepoint.com/:f:/r/sites/allardprize.org/Shared%20Documents/Shared%20Externally/AP%20-%20Donor%20Outreach%20System/Context?csf=1&web=1&e=sp2LcN";
// Fallback addressing if the shares API rejects the sharing URL.
const SP_HOSTNAME = "allardprize2.sharepoint.com";
const SP_SITE_PATH = "/sites/allardprize.org";
const SP_FOLDER_PATH = "Shared Externally/AP - Donor Outreach System/Context"; // relative to the default drive root

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";

const probe = process.argv.includes("--probe");
function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

// ---- persist the rotated Graph refresh token back to .env.local ----
const ENV_PATH = path.join(process.cwd(), ".env.local");
async function persistRefreshToken(token: string): Promise<void> {
  let text = readFileSync(ENV_PATH, "utf8");
  const key = /^MSGRAPH_REFRESH_TOKEN=/m.test(text)
    ? "MSGRAPH_REFRESH_TOKEN"
    : "ONEDRIVE_OAUTH_REFRESH_TOKEN";
  const line = `${key}=${token}`;
  text = new RegExp(`^${key}=.*$`, "m").test(text)
    ? text.replace(new RegExp(`^${key}=.*$`, "m"), line)
    : text.trimEnd() + `\n${line}\n`;
  writeFileSync(ENV_PATH, text);
  console.log(`[2g] rotated Graph refresh token persisted to .env.local (${key})`);
}

// ---- Google Drive (source) ----
function driveClient() {
  const clientId = process.env.GMAIL_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GMAIL_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_OAUTH_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Missing GMAIL_OAUTH_* env for Google Drive read");
  }
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  return google.drive({ version: "v3", auth: oauth2 });
}

type SourceFile = { id: string; name: string; mimeType: string };

async function listDriveFiles(): Promise<SourceFile[]> {
  const drive = driveClient();
  const out: SourceFile[] = [];
  let pageToken: string | undefined;
  do {
    const res = await drive.files.list({
      q: `'${DRIVE_SOURCE_FOLDER_ID}' in parents and trashed = false`,
      fields: "nextPageToken, files(id, name, mimeType)",
      pageSize: 1000,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      pageToken,
    });
    for (const f of res.data.files ?? []) {
      if (f.id && f.name && f.mimeType) out.push({ id: f.id, name: f.name, mimeType: f.mimeType });
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return out;
}

async function fetchAsDocx(file: SourceFile): Promise<{ bytes: Buffer; name: string; contentType: string }> {
  const drive = driveClient();
  if (file.mimeType === GOOGLE_DOC_MIME) {
    const res = await drive.files.export(
      { fileId: file.id, mimeType: DOCX_MIME },
      { responseType: "arraybuffer" }
    );
    const name = file.name.toLowerCase().endsWith(".docx") ? file.name : `${file.name}.docx`;
    return { bytes: Buffer.from(res.data as ArrayBuffer), name, contentType: DOCX_MIME };
  }
  // Non-Google-Doc: copy as-is.
  const res = await drive.files.get(
    { fileId: file.id, alt: "media", supportsAllDrives: true },
    { responseType: "arraybuffer" }
  );
  return { bytes: Buffer.from(res.data as ArrayBuffer), name: file.name, contentType: file.mimeType };
}

// ---- SharePoint folder resolution ----
async function resolveDestFolder(token: string): Promise<DriveItem> {
  try {
    const item = await resolveSharedItem(token, SHAREPOINT_FOLDER_URL);
    if (item?.id && item.parentReference?.driveId) return item;
  } catch (e) {
    console.log(`[2g] shares-API resolution failed (${e instanceof Error ? e.message : e}); trying site/path`);
  }
  // Fallback: site → default drive → path.
  const siteRes = await graphFetch(token, `/sites/${SP_HOSTNAME}:${SP_SITE_PATH}`);
  if (!siteRes.ok) throw new Error(`site resolve ${siteRes.status}: ${(await siteRes.text()).slice(0, 200)}`);
  const site = (await siteRes.json()) as { id: string };
  const driveRes = await graphFetch(token, `/sites/${site.id}/drive`);
  if (!driveRes.ok) throw new Error(`drive resolve ${driveRes.status}`);
  const drive = (await driveRes.json()) as { id: string };
  const encPath = SP_FOLDER_PATH.split("/").map(encodeURIComponent).join("/");
  const itemRes = await graphFetch(token, `/drives/${drive.id}/root:/${encPath}`);
  if (!itemRes.ok) throw new Error(`folder resolve ${itemRes.status}: ${(await itemRes.text()).slice(0, 200)}`);
  return (await itemRes.json()) as DriveItem;
}

// ---- repoint prospects at their SharePoint dossier ----
// Matches each SharePoint file "<Full Name> - Summary.docx" back to a prospect
// by fullName and sets dossierProvider='onedrive', dossierFileId='<driveId>:<itemId>'.
async function repoint(token: string, commit: boolean): Promise<void> {
  const { db } = await import("@/lib/db");
  const { prospects } = await import("@/lib/db/schema");
  const { eq } = await import("drizzle-orm");

  const folder = await resolveDestFolder(token);
  const driveId = folder.parentReference?.driveId;
  if (!driveId) throw new Error("resolved folder has no driveId");
  const children = await listChildren(token, driveId, folder.id);

  // SharePoint filename → itemId, keyed by lowercased base name (sans " - Summary.docx"/".docx").
  const byName = new Map<string, string>();
  for (const c of children) {
    if (!c.name || !c.id) continue;
    const base = c.name.replace(/\.docx$/i, "").replace(/\s*-\s*summary$/i, "").trim().toLowerCase();
    byName.set(base, c.id);
  }

  const rows = await db.select().from(prospects);
  let matched = 0;
  const misses: string[] = [];
  for (const p of rows) {
    if (p.archivedAt) continue;
    const itemId = byName.get(p.fullName.trim().toLowerCase());
    if (!itemId) {
      misses.push(p.fullName);
      continue;
    }
    matched += 1;
    const ref = `${driveId}:${itemId}`;
    if (commit) {
      await db
        .update(prospects)
        .set({ dossierProvider: "onedrive", dossierFileId: ref })
        .where(eq(prospects.id, p.id));
    }
    console.log(`[2g]   ${commit ? "set" : "would set"} ${p.fullName} → ${ref}`);
  }
  console.log(
    `[2g] repoint ${commit ? "COMMITTED" : "DRY-RUN"} — ${matched} matched, ${misses.length} unmatched` +
      (misses.length ? `: ${misses.join(", ")}` : "")
  );
}

async function main(): Promise<void> {
  // --seed-token: copy the env refresh token into the Postgres token store (run
  // once, locally, AFTER any .env.local-based op, before relying on the store).
  if (process.argv.includes("--seed-token")) {
    const { seedTokenStoreFromEnv } = await import("@/lib/msgraph/token-store");
    await seedTokenStoreFromEnv();
    console.log("[2g] token store seeded from env (app_token: msgraph_dossier)");
    return;
  }

  // --read <driveId:itemId>: verify the production reader (via the token store).
  const readRef = argValue("--read");
  if (process.argv.includes("--repoint")) {
    // Repoint reads SharePoint to map filenames → item ids; use the token store
    // so there's a single token source of truth going forward.
    const { getStoredGraphToken } = await import("@/lib/msgraph/token-store");
    await repoint(await getStoredGraphToken(), process.argv.includes("--commit"));
    return;
  }
  if (readRef) {
    const { readSharePointDossier } = await import("@/lib/dossiers/onedrive");
    const text = await readSharePointDossier(readRef);
    console.log(`[2g] read (token store) ${readRef} -> ${text.length} chars`);
    console.log("[2g] first 240 chars:\n" + text.slice(0, 240));
    return;
  }

  console.log(`[2g] ${probe ? "PROBE (no uploads)" : "COPY"} — Drive ${DRIVE_SOURCE_FOLDER_ID} → SharePoint Context`);

  const { accessToken } = await getGraphToken({ persistRefreshToken });
  console.log("[2g] Graph token acquired");

  const folder = await resolveDestFolder(accessToken);
  const driveId = folder.parentReference?.driveId;
  if (!driveId) throw new Error("resolved folder has no driveId");
  console.log(`[2g] dest folder: ${folder.name ?? "(Context)"} · item=${folder.id} · drive=${driveId}`);
  console.log(`[2g] dest webUrl: ${folder.webUrl ?? "(n/a)"}`);

  const existing = await listChildren(accessToken, driveId, folder.id);
  console.log(`[2g] dest currently has ${existing.length} item(s)${existing.length ? ": " + existing.map((c) => c.name).join(", ") : ""}`);

  const sources = await listDriveFiles();
  const docs = sources.filter((f) => f.mimeType === GOOGLE_DOC_MIME);
  const others = sources.filter((f) => f.mimeType !== GOOGLE_DOC_MIME && !f.mimeType.startsWith("application/vnd.google-apps"));
  const skipped = sources.filter((f) => f.mimeType !== GOOGLE_DOC_MIME && f.mimeType.startsWith("application/vnd.google-apps"));
  console.log(`[2g] source: ${sources.length} file(s) — ${docs.length} Google Docs → .docx, ${others.length} other (copied as-is), ${skipped.length} skipped (folders/sheets/slides)`);
  for (const s of skipped) console.log(`[2g]   skip: ${s.name} (${s.mimeType})`);

  if (probe) {
    console.log("[2g] PROBE complete — listing only. Source files:");
    for (const f of [...docs, ...others]) console.log(`[2g]   - ${f.name} (${f.mimeType})`);
    return;
  }

  let ok = 0;
  let failed = 0;
  for (const f of [...docs, ...others]) {
    try {
      const { bytes, name, contentType } = await fetchAsDocx(f);
      const up = await uploadFile(accessToken, driveId, folder.id, name, bytes, contentType);
      ok += 1;
      console.log(`[2g]   ✓ ${name} (${(bytes.byteLength / 1024).toFixed(0)} KB) → ${up.id}`);
    } catch (e) {
      failed += 1;
      console.error(`[2g]   ✗ ${f.name}: ${e instanceof Error ? e.message : e}`);
    }
  }
  console.log(`[2g] done — ${ok} uploaded, ${failed} failed, ${skipped.length} skipped`);
  if (failed > 0) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[2g] FAILED", err instanceof Error ? err.message : err);
    process.exit(1);
  });
