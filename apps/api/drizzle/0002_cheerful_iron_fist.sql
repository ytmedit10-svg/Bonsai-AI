CREATE TABLE "memory_artifacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"path_id" uuid NOT NULL,
	"artifact_type" text NOT NULL,
	"visibility" text DEFAULT 'path' NOT NULL,
	"content_text" text NOT NULL,
	"content_json" jsonb,
	"origin_path_id" uuid,
	"origin_message_id" uuid,
	"origin_merge_id" uuid,
	"token_estimate" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"source_path_id" uuid NOT NULL,
	"target_path_id" uuid NOT NULL,
	"merge_mode" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"result_artifact_id" uuid,
	"result_message_id" uuid,
	"error_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "memory_artifacts" ADD CONSTRAINT "memory_artifacts_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_artifacts" ADD CONSTRAINT "memory_artifacts_path_id_paths_id_fk" FOREIGN KEY ("path_id") REFERENCES "public"."paths"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_artifacts" ADD CONSTRAINT "memory_artifacts_origin_path_id_paths_id_fk" FOREIGN KEY ("origin_path_id") REFERENCES "public"."paths"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_artifacts" ADD CONSTRAINT "memory_artifacts_origin_message_id_messages_id_fk" FOREIGN KEY ("origin_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merges" ADD CONSTRAINT "merges_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merges" ADD CONSTRAINT "merges_source_path_id_paths_id_fk" FOREIGN KEY ("source_path_id") REFERENCES "public"."paths"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merges" ADD CONSTRAINT "merges_target_path_id_paths_id_fk" FOREIGN KEY ("target_path_id") REFERENCES "public"."paths"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merges" ADD CONSTRAINT "merges_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merges" ADD CONSTRAINT "merges_result_message_id_messages_id_fk" FOREIGN KEY ("result_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memory_artifacts_path_created_idx" ON "memory_artifacts" USING btree ("path_id","created_at");--> statement-breakpoint
CREATE INDEX "memory_artifacts_conversation_type_created_idx" ON "memory_artifacts" USING btree ("conversation_id","artifact_type","created_at");--> statement-breakpoint
CREATE INDEX "merges_source_created_idx" ON "merges" USING btree ("source_path_id","created_at");--> statement-breakpoint
CREATE INDEX "merges_target_created_idx" ON "merges" USING btree ("target_path_id","created_at");--> statement-breakpoint
CREATE INDEX "merges_status_created_idx" ON "merges" USING btree ("status","created_at");