CREATE TABLE "cache_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid,
	"path_id" uuid,
	"cache_key" text NOT NULL,
	"cache_scope" text NOT NULL,
	"model_name" text NOT NULL,
	"gemini_cached_content_name" text NOT NULL,
	"content_hash" text NOT NULL,
	"token_estimate" integer,
	"ttl_seconds" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cache_records" ADD CONSTRAINT "cache_records_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cache_records" ADD CONSTRAINT "cache_records_path_id_paths_id_fk" FOREIGN KEY ("path_id") REFERENCES "public"."paths"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cache_records_path_status_expires_idx" ON "cache_records" USING btree ("path_id","status","expires_at");--> statement-breakpoint
CREATE INDEX "cache_records_conversation_status_expires_idx" ON "cache_records" USING btree ("conversation_id","status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cache_records_cache_key_unique" ON "cache_records" USING btree ("cache_key");