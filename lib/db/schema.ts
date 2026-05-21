import {
  boolean,
  index,
  integer,
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

// ---------- Domain tables ----------
// Phase 2A includes only `prospects` to prove the schema + migration loop.
// Phase 2B+ adds sources, results, touchpoints_assigned, monitoring_results,
// touchpoints_potential, briefings, cron_runs, eval_cases, eval_runs.

export const profileType = pgEnum("profile_type", ["individual", "organization"]);
export const dossierProvider = pgEnum("dossier_provider", ["google_docs", "onedrive"]);

export const prospects = pgTable(
  "prospect",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    fullName: text("full_name").notNull(),
    profileType: profileType("profile_type").notNull(),
    linkedInUrl: text("linkedin_url"),
    linkedInEnabled: boolean("linkedin_enabled").notNull().default(false),
    dossierProvider: dossierProvider("dossier_provider"),
    dossierFileId: text("dossier_file_id"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { mode: "date" }),
  },
  (t) => ({
    profileTypeIdx: index("prospect_profile_type_idx").on(t.profileType),
    deletedAtIdx: index("prospect_deleted_at_idx").on(t.deletedAt),
  })
);
