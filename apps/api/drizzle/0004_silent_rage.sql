CREATE TABLE "model_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"path_id" uuid NOT NULL,
	"message_id" uuid,
	"merge_id" uuid,
	"run_type" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"model_provider" text NOT NULL,
	"model_name" text NOT NULL,
	"cache_mode" text DEFAULT 'none' NOT NULL,
	"cache_record_id" uuid,
	"input_tokens" integer,
	"output_tokens" integer,
	"cached_tokens" integer,
	"estimated_cost_usd" numeric(12, 6),
	"latency_ms" integer,
	"request_payload_json" jsonb,
	"response_payload_json" jsonb,
	"error_text" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "model_runs" ADD CONSTRAINT "model_runs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_runs" ADD CONSTRAINT "model_runs_path_id_paths_id_fk" FOREIGN KEY ("path_id") REFERENCES "public"."paths"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_runs" ADD CONSTRAINT "model_runs_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_runs" ADD CONSTRAINT "model_runs_merge_id_merges_id_fk" FOREIGN KEY ("merge_id") REFERENCES "public"."merges"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_runs" ADD CONSTRAINT "model_runs_cache_record_id_cache_records_id_fk" FOREIGN KEY ("cache_record_id") REFERENCES "public"."cache_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "model_runs_path_created_idx" ON "model_runs" USING btree ("path_id","created_at");--> statement-breakpoint
CREATE INDEX "model_runs_status_created_idx" ON "model_runs" USING btree ("status","created_at");