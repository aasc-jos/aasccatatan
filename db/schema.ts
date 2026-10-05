import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";

// Folders created by visitors. Built-in folders live in index.html and are
// referenced by notes through their stable "builtin-folder-<CODE>" id.
export const folders = pgTable("folders", {
  id: text().primaryKey(),
  name: text().notNull(),
  code: text().notNull(),
  color: text().notNull().default("teal"),
  ownerHash: text("owner_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const notes = pgTable(
  "notes",
  {
    id: text().primaryKey(),
    folderId: text("folder_id").notNull(),
    title: text().notNull(),
    code: text().notNull().default(""),
    html: text().notNull(),
    ownerHash: text("owner_hash").notNull(),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("notes_folder_id_idx").on(t.folderId)],
);
