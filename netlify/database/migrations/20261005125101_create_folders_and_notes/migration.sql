CREATE TABLE "folders" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"color" text DEFAULT 'teal' NOT NULL,
	"owner_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" text PRIMARY KEY,
	"folder_id" text NOT NULL,
	"title" text NOT NULL,
	"code" text DEFAULT '' NOT NULL,
	"html" text NOT NULL,
	"owner_hash" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "notes_folder_id_idx" ON "notes" ("folder_id");