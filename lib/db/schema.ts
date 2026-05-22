import {
  boolean,
  index,
  integer,
  jsonb,
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
