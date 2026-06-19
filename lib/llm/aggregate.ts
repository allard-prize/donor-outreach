import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  prospects,
  results,
  touchpointsAssigned,
} from "@/lib/db/schema";

export type AgentResultItem = {
  resultId: string;
  sourceType: "rss" | "email" | "linkedin_post";
  title: string;
  link: string;
  pubDate: string;
  contentSnippet: string;
  processedStatus: "pending" | "processed" | "skipped";
};

export type AgentTouchpoint = {
  touchpointType: string;
  completedDate: string;
  summary: string;
  response: string | null;
  nextStep: string | null;
};

export type AggregatedProspect = {
  prospectId: string;
  fullName: string;
  profileType: string;
  dossierProvider: "google_docs" | "onedrive" | null;
  dossierFileId: string | null;
  results: AgentResultItem[];
  touchpoints: AgentTouchpoint[];
  // resultIds = the cleaned subset actually passed to the LLM (→ processed).
  // allResultIds = every pending result for the prospect; the difference
  // (deduped / overflow) is marked `skipped` so the queue fully resolves.
  resultIds: string[];
  allResultIds: string[];
};

/**
 * Pull all `pending` results joined with their prospect, group by prospect,
 * attach the last 5 touchpoints and dossier config. Skips prospects that have
 * been archived.
 *
 * Returns one entry per prospect with at least one pending result.
 *
 * `opts.onlyProspectIds` scopes the run to specific prospects — used by the
 * smoke test so it touches ONLY its fixture (the orchestrator otherwise pulls
 * every pending prospect, which would clobber real data in a test).
 */
export async function aggregatePendingByProspect(opts?: {
  onlyProspectIds?: string[];
}): Promise<AggregatedProspect[]> {
  const onlyIds = opts?.onlyProspectIds;
  if (onlyIds && onlyIds.length === 0) return [];

  const rows = await db
    .select({
      resultId: results.id,
      prospectId: results.prospectId,
      sourceType: results.sourceType,
      title: results.title,
      link: results.link,
      pubDate: results.pubDate,
      contentSnippet: results.contentSnippet,
      processedStatus: results.processedStatus,
      fullName: prospects.fullName,
      profileType: prospects.profileType,
      dossierProvider: prospects.dossierProvider,
      dossierFileId: prospects.dossierFileId,
    })
    .from(results)
    .innerJoin(prospects, eq(results.prospectId, prospects.id))
    .where(
      and(
        eq(results.processedStatus, "pending"),
        isNull(prospects.archivedAt),
        ...(onlyIds ? [inArray(results.prospectId, onlyIds)] : [])
      )
    )
    .orderBy(asc(results.prospectId), asc(results.pubDate));

  if (rows.length === 0) return [];

  const grouped = new Map<string, AggregatedProspect>();
  for (const r of rows) {
    let g = grouped.get(r.prospectId);
    if (!g) {
      g = {
        prospectId: r.prospectId,
        fullName: r.fullName,
        profileType: r.profileType,
        dossierProvider: r.dossierProvider,
        dossierFileId: r.dossierFileId,
        results: [],
        touchpoints: [],
        resultIds: [],
        allResultIds: [],
      };
      grouped.set(r.prospectId, g);
    }
    g.results.push({
      resultId: r.resultId,
      sourceType: r.sourceType,
      title: r.title,
      link: r.link ?? "",
      pubDate: r.pubDate.toISOString(),
      contentSnippet: r.contentSnippet,
      processedStatus: r.processedStatus,
    });
    // Full pending set; the passed subset (resultIds) is set by cleanProspectPayload.
    g.allResultIds.push(r.resultId);
  }

  const prospectIds = Array.from(grouped.keys());
  const touchpointRows = await db
    .select({
      prospectId: touchpointsAssigned.prospectId,
      touchpointType: touchpointsAssigned.touchpointType,
      completedDate: touchpointsAssigned.completedDate,
      summary: touchpointsAssigned.summary,
      response: touchpointsAssigned.response,
      nextStep: touchpointsAssigned.nextStep,
    })
    .from(touchpointsAssigned)
    .where(inArray(touchpointsAssigned.prospectId, prospectIds))
    .orderBy(desc(touchpointsAssigned.completedDate));

  for (const t of touchpointRows) {
    const g = grouped.get(t.prospectId);
    if (!g || g.touchpoints.length >= 5) continue;
    g.touchpoints.push({
      touchpointType: t.touchpointType,
      completedDate: t.completedDate,
      summary: t.summary,
      response: t.response,
      nextStep: t.nextStep,
    });
  }

  return Array.from(grouped.values()).map((p) => cleanProspectPayload(p));
}

const ALERT_TRACKING_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "rcm",
  "lipi",
  "midToken",
  "midSig",
  "trk",
  "trkEmail",
  "eid",
  "otpToken",
  "loid",
];

export function cleanUrl(url: string | null | undefined): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    for (const p of ALERT_TRACKING_PARAMS) u.searchParams.delete(p);
    return u.toString();
  } catch {
    return url;
  }
}

export function cleanEmailHtml(html: string | null | undefined): string {
  if (!html || typeof html !== "string") return "";
  let text = html.split("----------------------------------------")[0];
  text = text.replace(/<[^>]+>/g, " ");
  text = text.replace(/\s+/g, " ").trim();
  return text.substring(0, 800);
}

function dedupeAlerts<T extends { title?: string }>(alerts: T[]): T[] {
  const seen = new Set<string>();
  return alerts.filter((a) => {
    const key = (a.title || "")
      .replace(/<[^>]+>/g, "")
      .toLowerCase()
      .substring(0, 60);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Port of Phase 1 `Clean Results` node. Strips email HTML, dedupes RSS alerts,
 * truncates long content, cleans tracking params from URLs.
 */
function cleanProspectPayload(p: AggregatedProspect): AggregatedProspect {
  const emails = p.results.filter((r) => r.sourceType === "email");
  let alerts = p.results.filter((r) => r.sourceType === "rss");
  const linkedin = p.results.filter((r) => r.sourceType === "linkedin_post");

  for (const e of emails) {
    e.contentSnippet = cleanEmailHtml(e.contentSnippet);
    e.link = cleanUrl(e.link);
  }

  alerts = dedupeAlerts(alerts);
  if (alerts.length > 10) alerts = alerts.slice(-10);
  for (const a of alerts) {
    a.link = cleanUrl(a.link);
    a.title = (a.title || "")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"');
    if (a.contentSnippet && a.contentSnippet.length > 300) {
      a.contentSnippet = a.contentSnippet.substring(0, 300) + "...";
    }
  }

  for (const l of linkedin) {
    l.link = cleanUrl(l.link);
  }

  return {
    ...p,
    results: [...linkedin, ...emails, ...alerts],
    resultIds: [...linkedin, ...emails, ...alerts].map((r) => r.resultId),
  };
}

/**
 * Convert the internal `sourceType` enum to the `alert_source` enum the agent
 * prompt expects. This mirrors the Phase 1 Sheets→Agent shape.
 */
export function toAgentResultShape(items: AgentResultItem[]) {
  return items.map((r) => ({
    resultId: r.resultId,
    sourceType: mapSourceTypeToAgent(r.sourceType),
    title: r.title,
    link: r.link,
    pubDate: r.pubDate,
    contentSnippet: r.contentSnippet,
  }));
}

function mapSourceTypeToAgent(
  s: "rss" | "email" | "linkedin_post"
): "google_alert" | "email" | "linkedin" {
  switch (s) {
    case "rss":
      return "google_alert";
    case "email":
      return "email";
    case "linkedin_post":
      return "linkedin";
  }
}
