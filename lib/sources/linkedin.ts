import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { prospects, results } from "@/lib/db/schema";

export type LinkedInCaptureSummary = {
  prospectsChecked: number;
  prospectsWithUrl: number;
  prospectsScraped: number;
  prospectsTimedOut: number;
  postsScanned: number;
  postsInserted: number;
  postsSkipped: number;
  prospectsFailed: { prospectId: string; fullName: string; error: string }[];
};

type EligibleProspect = {
  id: string;
  fullName: string;
  linkedInUrl: string;
};

type ProfileType = "personal" | "company";

type ParsedLinkedInUrl = {
  username: string;
  type: ProfileType;
};

type ApifyPost = {
  full_urn?: string;
  posted_at?: { date?: string };
  url?: string;
  post_url?: string;
  text?: string;
};

// Apify actor IDs — copied verbatim from capture-linkedin-posts.json (Phase 1 n8n workflow).
const PERSONAL_ACTOR_ID = "LQQIXN9Othf8f7R5n";
const COMPANY_ACTOR_ID = "mrThmKLmkxJPehxCg";

const POSTS_PER_PROSPECT = 20;
const FRESH_WINDOW_DAYS = 21;
const TITLE_CAP = 500;
const SNIPPET_CAP = 4000;

// Total wall-time budget for all Apify polling. Vercel maxDuration is 60s; we
// leave ~10s of headroom for DB writes and the parent handler's response.
const TOTAL_BUDGET_MS = 50_000;
// Per-call ceiling — Apify's `timeout` query param is in seconds, max 60.
const PER_CALL_TIMEOUT_S = 50;

export function parseLinkedInUrl(url: string | null | undefined): ParsedLinkedInUrl | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  const personalMatch = trimmed.match(/linkedin\.com\/in\/([^/?#]+)/i);
  if (personalMatch?.[1]) {
    return { username: personalMatch[1], type: "personal" };
  }

  const companyMatch = trimmed.match(/linkedin\.com\/company\/([^/?#]+)/i);
  if (companyMatch?.[1]) {
    return { username: companyMatch[1], type: "company" };
  }

  return null;
}

export async function captureLinkedIn(): Promise<LinkedInCaptureSummary> {
  const summary: LinkedInCaptureSummary = {
    prospectsChecked: 0,
    prospectsWithUrl: 0,
    prospectsScraped: 0,
    prospectsTimedOut: 0,
    postsScanned: 0,
    postsInserted: 0,
    postsSkipped: 0,
    prospectsFailed: [],
  };

  const token = process.env.APIFY_API_TOKEN;
  if (!token) {
    // Diagnostic: enumerate env keys matching APIFY/AUTH/CRON to verify the
    // var is or isn't reaching the runtime. Values intentionally omitted —
    // only key names are dumped.
    const visibleKeys = Object.keys(process.env)
      .filter((k) => /^(APIFY|AUTH_|CRON_|GMAIL_|DATABASE_|ADMIN_)/.test(k))
      .sort();
    throw new Error(
      `Missing APIFY_API_TOKEN env. process.env keys matching expected prefixes: [${visibleKeys.join(", ")}]`
    );
  }

  const eligible = await loadEligibleProspects();
  summary.prospectsChecked = eligible.length;
  if (eligible.length === 0) return summary;

  const startedAt = Date.now();
  const deadline = startedAt + TOTAL_BUDGET_MS;

  await Promise.allSettled(
    eligible.map((prospect) => scrapeProspect(prospect, token, deadline, summary))
  );

  return summary;
}

async function loadEligibleProspects(): Promise<EligibleProspect[]> {
  const rows = await db
    .select({
      id: prospects.id,
      fullName: prospects.fullName,
      linkedInUrl: prospects.linkedInUrl,
    })
    .from(prospects)
    .where(and(eq(prospects.linkedInEnabled, true), isNull(prospects.archivedAt)));

  return rows.flatMap((row) => {
    if (!row.linkedInUrl) return [];
    return [{ id: row.id, fullName: row.fullName, linkedInUrl: row.linkedInUrl }];
  });
}

async function scrapeProspect(
  prospect: EligibleProspect,
  token: string,
  deadline: number,
  summary: LinkedInCaptureSummary
): Promise<void> {
  const parsed = parseLinkedInUrl(prospect.linkedInUrl);
  if (!parsed) return;
  summary.prospectsWithUrl += 1;

  const remainingMs = deadline - Date.now();
  if (remainingMs <= 1_000) {
    summary.prospectsTimedOut += 1;
    return;
  }

  try {
    const posts = await runApifyActor(parsed, token, remainingMs);
    summary.prospectsScraped += 1;
    summary.postsScanned += posts.length;

    const rows = filterAndShapePosts(posts, prospect);
    if (rows.length === 0) return;

    const inserted = await db
      .insert(results)
      .values(rows)
      .onConflictDoNothing({ target: results.id })
      .returning({ id: results.id });

    summary.postsInserted += inserted.length;
    summary.postsSkipped += rows.length - inserted.length;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/abort|timeout/i.test(message)) {
      summary.prospectsTimedOut += 1;
      return;
    }
    summary.prospectsFailed.push({
      prospectId: prospect.id,
      fullName: prospect.fullName,
      error: message,
    });
  }
}

async function runApifyActor(
  parsed: ParsedLinkedInUrl,
  token: string,
  remainingMs: number
): Promise<ApifyPost[]> {
  const actorId = parsed.type === "personal" ? PERSONAL_ACTOR_ID : COMPANY_ACTOR_ID;
  const body =
    parsed.type === "personal"
      ? { username: parsed.username, limit: POSTS_PER_PROSPECT, page_number: 1 }
      : {
          company_name: parsed.username,
          limit: POSTS_PER_PROSPECT,
          page_number: 1,
          sort: "recent",
        };

  const timeoutS = Math.min(PER_CALL_TIMEOUT_S, Math.max(1, Math.floor(remainingMs / 1000)));
  const url = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?timeout=${timeoutS}`;

  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), remainingMs);

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Apify ${resp.status}: ${text.slice(0, 200)}`);
    }
    const data = (await resp.json()) as unknown;
    return Array.isArray(data) ? (data as ApifyPost[]) : [];
  } finally {
    clearTimeout(abortTimer);
  }
}

function filterAndShapePosts(posts: ApifyPost[], prospect: EligibleProspect) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - FRESH_WINDOW_DAYS);

  return posts.flatMap((post) => {
    const id = post.full_urn;
    if (!id) return [];

    const dateStr = post.posted_at?.date;
    if (!dateStr) return [];
    const pubDate = new Date(dateStr);
    if (Number.isNaN(pubDate.getTime()) || pubDate < cutoff) return [];

    const link = `${post.url ?? ""}${post.post_url ?? ""}` || null;

    return [
      {
        id,
        sourceId: null,
        prospectId: prospect.id,
        sourceType: "linkedin_post" as const,
        title: "".slice(0, TITLE_CAP),
        link,
        pubDate,
        contentSnippet: (post.text ?? "").slice(0, SNIPPET_CAP),
        processedStatus: "pending" as const,
      },
    ];
  });
}
