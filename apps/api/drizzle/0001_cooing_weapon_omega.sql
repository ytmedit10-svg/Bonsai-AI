CREATE TABLE "path_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"path_id" uuid NOT NULL,
	"snapshot_kind" text DEFAULT 'split_memory' NOT NULL,
	"source_path_id" uuid NOT NULL,
	"source_message_id" uuid,
	"version_no" integer DEFAULT 1 NOT NULL,
	"snapshot_text" text NOT NULL,
	"snapshot_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "path_snapshots" ADD CONSTRAINT "path_snapshots_path_id_paths_id_fk" FOREIGN KEY ("path_id") REFERENCES "public"."paths"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "path_snapshots" ADD CONSTRAINT "path_snapshots_source_path_id_paths_id_fk" FOREIGN KEY ("source_path_id") REFERENCES "public"."paths"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "path_snapshots" ADD CONSTRAINT "path_snapshots_source_message_id_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "path_snapshots_path_version_idx" ON "path_snapshots" USING btree ("path_id","version_no");--> statement-breakpoint
CREATE INDEX "path_snapshots_source_message_idx" ON "path_snapshots" USING btree ("source_message_id");