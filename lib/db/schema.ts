import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createId } from "@/lib/db/id";

// ---------- Auth.js v5 tables ----------

export const users = pgTable("user", {
  id: text("id").primaryKey().$defaultFn(createId),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("emailVerified", { mode: "date" }),
  image: text("image"),
});

export const accounts = pgTable(
  "account",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => ({
    pk: primaryKey({ columns: [account.provider, account.providerAccountId] }),
  })
);

export const sessions = pgTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (vt) => ({
    pk: primaryKey({ columns: [vt.identifier, vt.token] }),
  })
);

// ---------- Domain enums ----------

export const profileType = pgEnum("profile_type", [
  "institutional_funder",
  "individual_donor",
  "connector",
  "credibility_node",
  "collaborator",
  // Phase 2F: the Phase 1 prospects sheet has no profileType column, so migrated
  // rows land here until classified in the Phase 2D admin UI.
  "unknown",
]);

export const dossierProvider = pgEnum("dossier_provider", [
  "google_docs",
  "onedrive",
]);

export const sourceType = pgEnum("source_type", [
  "rss",
  "email",
  "linkedin_post",
]);

export const processedStatus = pgEnum("processed_status", [
  "pending",
  "processed",
]);

export const cronJobName = pgEnum("cron_job_name", [
  "rss",
  "email_capture",
  "linkedin_scrape",
  "donor_outreach",
  "health_check",
]);

export const cronRunStatus = pgEnum("cron_run_status", [
  "running",
  "success",
  "failure",
  "partial",
]);

export const relationshipStage = pgEnum("relationship_stage", [
  "no_relationship",
  "early",
  "warm",
  "active",
  "stalled",
  "dormant",
]);

export const responsiveness = pgEnum("responsiveness", [
  "high",
  "moderate",
  "low",
  "none",
]);

export const momentum = pgEnum("momentum", [
  "increasing",
  "stable",
  "declining",
]);

export const touchpointType = pgEnum("touchpoint_type", [
  "congratulations",
  "collaboration",
  "content_sharing",
  "introduction",
  "meeting_request",
  "invitation",
  "intermediary_engagement",
  "follow_up",
  "no_action",
  // Phase 2F: historic touchpoint sheet uses a channel/shorthand vocab that
  // doesn't map cleanly (e.g. "email"); imported rows land here until refined.
  // The agent never emits this value — it's import-only.
  "other",
]);

export const touchpointReviewStatus = pgEnum("touchpoint_review_status", [
  "pending",
  "approved",
  "rejected",
  "promoted",
]);

export const briefingStatus = pgEnum("briefing_status", [
  "sent",
  "failed",
  "partial",
]);

// ---------- Domain tables ----------

export const prospects = pgTable(
  "prospect",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    fullName: text("full_name").notNull(),
    profileType: profileType("profile_type").notNull(),
    linkedInUrl: text("linkedin_url"),
    emailEnabled: boolean("email_enabled").notNull().default(false),
    linkedInEnabled: boolean("linkedin_enabled").notNull().default(false),
    dossierProvider: dossierProvider("dossier_provider"),
    dossierFileId: text("dossier_file_id"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { mode: "date" }),
  },
  (t) => ({
    profileTypeIdx: index("prospect_profile_type_idx").on(t.profileType),
    archivedAtIdx: index("prospect_archived_at_idx").on(t.archivedAt),
  })
);

export const sources = pgTable(
  "source",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    prospectId: text("prospect_id")
      .notNull()
      .references(() => prospects.id, { onDelete: "cascade" }),
    rssUrl: text("rss_url").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    disabledAt: timestamp("disabled_at", { mode: "date" }),
  },
  (t) => ({
    prospectIdx: index("source_prospect_idx").on(t.prospectId),
    disabledAtIdx: index("source_disabled_at_idx").on(t.disabledAt),
  })
);

export const results = pgTable(
  "result",
  {
    id: text("id").primaryKey(), // resultId per spec — Gmail msg id for emails, generated for rss/linkedin
    sourceId: text("source_id").references(() => sources.id, { onDelete: "set null" }),
    prospectId: text("prospect_id")
      .notNull()
      .references(() => prospects.id, { onDelete: "cascade" }),
    sourceType: sourceType("source_type").notNull(),
    title: text("title").notNull(),
    link: text("link"),
    pubDate: timestamp("pub_date", { mode: "date" }).notNull(),
    contentSnippet: text("content_snippet").notNull().default(""),
    processedStatus: processedStatus("processed_status").notNull().default("pending"),
    capturedAt: timestamp("captured_at", { mode: "date" }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { mode: "date" }),
  },
  (t) => ({
    prospectIdx: index("result_prospect_idx").on(t.prospectId),
    sourceTypeIdx: index("result_source_type_idx").on(t.sourceType),
    processedStatusIdx: index("result_processed_status_idx").on(t.processedStatus),
    pubDateIdx: index("result_pub_date_idx").on(t.pubDate),
  })
);

export const cronRuns = pgTable(
  "cron_run",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    jobName: cronJobName("job_name").notNull(),
    startedAt: timestamp("started_at", { mode: "date" }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { mode: "date" }),
    status: cronRunStatus("status").notNull().default("running"),
    itemsProcessed: integer("items_processed").notNull().default(0),
    errorMessage: text("error_message"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  },
  (t) => ({
    jobNameIdx: index("cron_run_job_name_idx").on(t.jobName),
    startedAtIdx: index("cron_run_started_at_idx").on(t.startedAt),
  })
);

export const touchpointsAssigned = pgTable(
  "touchpoint_assigned",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    prospectId: text("prospect_id")
      .notNull()
      .references(() => prospects.id, { onDelete: "cascade" }),
    touchpointType: touchpointType("touchpoint_type").notNull(),
    completedDate: date("completed_date", { mode: "string" }).notNull(),
    summary: text("summary").notNull().default(""),
    response: text("response"),
    nextStep: text("next_step"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => ({
    prospectIdx: index("touchpoint_assigned_prospect_idx").on(t.prospectId),
    completedDateIdx: index("touchpoint_assigned_completed_date_idx").on(t.completedDate),
  })
);

// ---------- Phase 2C: decision-path tables ----------

export const briefings = pgTable(
  "briefing",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    cronRunId: text("cron_run_id").references(() => cronRuns.id, {
      onDelete: "set null",
    }),
    sentAt: timestamp("sent_at", { mode: "date" }).notNull().defaultNow(),
    recipients: jsonb("recipients").$type<string[]>().notNull(),
    prospectCount: integer("prospect_count").notNull().default(0),
    alertCount: integer("alert_count").notNull().default(0),
    htmlBody: text("html_body").notNull().default(""),
    subject: text("subject").notNull().default(""),
    llmCostUsd: numeric("llm_cost_usd", { precision: 10, scale: 4 })
      .notNull()
      .default("0"),
    llmCallCount: integer("llm_call_count").notNull().default(0),
    status: briefingStatus("status").notNull().default("sent"),
    errorMessage: text("error_message"),
  },
  (t) => ({
    sentAtIdx: index("briefing_sent_at_idx").on(t.sentAt),
    statusIdx: index("briefing_status_idx").on(t.status),
  })
);

export const monitoringResults = pgTable(
  "monitoring_result",
  {
    id: text("id").primaryKey(), // `${prospectId}_${runDateIso}` per spec
    prospectId: text("prospect_id")
      .notNull()
      .references(() => prospects.id, { onDelete: "cascade" }),
    runDate: date("run_date", { mode: "string" }).notNull(),
    stage: relationshipStage("stage").notNull(),
    responsiveness: responsiveness("responsiveness").notNull(),
    momentum: momentum("momentum").notNull(),
    interpretation: text("interpretation").notNull().default(""),
    summary: text("summary").notNull().default(""),
    keyAlerts: jsonb("key_alerts").$type<unknown[]>().notNull().default([]),
    briefingId: text("briefing_id").references(() => briefings.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => ({
    prospectIdx: index("monitoring_result_prospect_idx").on(t.prospectId),
    runDateIdx: index("monitoring_result_run_date_idx").on(t.runDate),
  })
);

export const touchpointsPotential = pgTable(
  "touchpoint_potential",
  {
    id: text("id").primaryKey(), // `${prospectId}_${runDateIso}` per spec
    prospectId: text("prospect_id")
      .notNull()
      .references(() => prospects.id, { onDelete: "cascade" }),
    runDate: date("run_date", { mode: "string" }).notNull(),
    touchpointType: touchpointType("touchpoint_type").notNull(),
    priorityScore: integer("priority_score").notNull(),
    engagementRationale: text("engagement_rationale").notNull().default(""),
    draftContent: text("draft_content").notNull().default(""),
    reviewStatus: touchpointReviewStatus("review_status")
      .notNull()
      .default("pending"),
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { mode: "date" }),
    promotedToAssignedId: text("promoted_to_assigned_id"),
    briefingId: text("briefing_id").references(() => briefings.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => ({
    prospectIdx: index("touchpoint_potential_prospect_idx").on(t.prospectId),
    runDateIdx: index("touchpoint_potential_run_date_idx").on(t.runDate),
    reviewStatusIdx: index("touchpoint_potential_review_status_idx").on(
      t.reviewStatus
    ),
    priorityScoreIdx: index("touchpoint_potential_priority_score_idx").on(
      t.priorityScore
    ),
  })
);
