import Parser from "rss-parser";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { sources, results, prospects } from "@/lib/db/schema";

export type RssCaptureSummary = {
  feedsRead: number;
  feedsFailed: number;
  itemsInserted: number;
  itemsSkipped: number;
  failedFeeds: { sourceId: string; rssUrl: string; error: string }[];
};

type EligibleSource = {
  sourceId: string;
  rssUrl: string;
  prospectId: string;
};

const parser = new Parser({ timeout: 15_000 });

export async function captureRss(): Promise<RssCaptureSummary> {
  const rows = await db
    .select({
      sourceId: sources.id,
      rssUrl: sources.rssUrl,
      prospectId: prospects.id,
    })
    .from(sources)
    .innerJoin(prospects, eq(sources.prospectId, prospects.id))
    .where(and(isNull(sources.disabledAt), isNull(prospects.archivedAt)));

  const eligible: EligibleSource[] = rows.filter((r) => r.rssUrl.trim().length > 0);

  const summary: RssCaptureSummary = {
    feedsRead: 0,
    feedsFailed: 0,
    itemsInserted: 0,
    itemsSkipped: 0,
    failedFeeds: [],
  };

  for (const source of eligible) {
    try {
      const feed = await parser.parseURL(source.rssUrl);
      summary.feedsRead += 1;

      const newRows = feed.items
        .map((item) => buildResultRow(source, item))
        .filter((r): r is NonNullable<typeof r> => r !== null);

      if (newRows.length === 0) continue;

      const inserted = await db
        .insert(results)
        .values(newRows)
        .onConflictDoNothing({ target: results.id })
        .returning({ id: results.id });

      summary.itemsInserted += inserted.length;
      summary.itemsSkipped += newRows.length - inserted.length;
    } catch (err) {
      summary.feedsFailed += 1;
      summary.failedFeeds.push({
        sourceId: source.sourceId,
        rssUrl: source.rssUrl,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return summary;
}

function buildResultRow(
  source: EligibleSource,
  item: {
    guid?: string;
    link?: string;
    title?: string;
    pubDate?: string;
    isoDate?: string;
    contentSnippet?: string;
    content?: string;
  }
) {
  const id = item.guid ?? item.link;
  if (!id || !item.title) return null;

  const pubDateStr = item.isoDate ?? item.pubDate;
  const pubDate = pubDateStr ? new Date(pubDateStr) : new Date();
  if (Number.isNaN(pubDate.getTime())) return null;

  return {
    id,
    sourceId: source.sourceId,
    prospectId: source.prospectId,
    sourceType: "rss" as const,
    title: item.title.slice(0, 500),
    link: item.link ?? null,
    pubDate,
    contentSnippet: (item.contentSnippet ?? item.content ?? "").slice(0, 4000),
    processedStatus: "pending" as const,
  };
}
