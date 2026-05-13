CREATE TABLE "embedding_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source_type" text NOT NULL,
  "source_id" uuid NOT NULL,
  "conversation_id" uuid NOT NULL,
  "path_id" uuid,
  "visibility" text DEFAULT 'conversation' NOT NULL,
  "content_text" text NOT NULL,
  "content_hash" text NOT NULL,
  "embedding_model" text NOT NULL,
  "embedding_dimensions" integer NOT NULL,
  "embedding_json" jsonb NOT NULL,
  "token_estimate" integer,
  "metadata_json" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "embedding_records" ADD CONSTRAINT "embedding_records_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "embedding_records" ADD CONSTRAINT "embedding_records_path_id_paths_id_fk" FOREIGN KEY ("path_id") REFERENCES "public"."paths"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "embedding_records_conversation_path_idx" ON "embedding_records" USING btree ("conversation_id","path_id");
--> statement-breakpoint
CREATE INDEX "embedding_records_source_idx" ON "embedding_records" USING btree ("source_type","source_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "embedding_records_source_model_unique" ON "embedding_records" USING btree ("source_type","source_id","embedding_model");
--> statement-breakpoint
CREATE INDEX "embedding_records_visibility_idx" ON "embedding_records" USING btree ("visibility");
