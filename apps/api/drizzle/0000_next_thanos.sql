CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"main_path_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"path_id" uuid NOT NULL,
	"role" text NOT NULL,
	"message_type" text DEFAULT 'chat' NOT NULL,
	"content_text" text NOT NULL,
	"content_json" jsonb,
	"sequence_no" integer NOT NULL,
	"created_by" text NOT NULL,
	"model_provider" text,
	"model_name" text,
	"status" text DEFAULT 'completed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paths" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"parent_path_id" uuid,
	"root_path_id" uuid,
	"split_from_message_id" uuid,
	"path_type" text DEFAULT 'chat' NOT NULL,
	"is_main" boolean DEFAULT false NOT NULL,
	"title" text NOT NULL,
	"depth" integer DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_main_path_id_paths_id_fk" FOREIGN KEY ("main_path_id") REFERENCES "public"."paths"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_path_id_paths_id_fk" FOREIGN KEY ("path_id") REFERENCES "public"."paths"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paths" ADD CONSTRAINT "paths_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paths" ADD CONSTRAINT "paths_parent_path_id_paths_id_fk" FOREIGN KEY ("parent_path_id") REFERENCES "public"."paths"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paths" ADD CONSTRAINT "paths_root_path_id_paths_id_fk" FOREIGN KEY ("root_path_id") REFERENCES "public"."paths"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversations_user_updated_idx" ON "conversations" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_path_sequence_unique" ON "messages" USING btree ("path_id","sequence_no");--> statement-breakpoint
CREATE INDEX "messages_conversation_created_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "paths_conversation_created_idx" ON "paths" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "paths_parent_created_idx" ON "paths" USING btree ("parent_path_id","created_at");--> statement-breakpoint
CREATE INDEX "paths_root_created_idx" ON "paths" USING btree ("root_path_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "paths_one_main_path_per_conversation" ON "paths" USING btree ("conversation_id") WHERE "paths"."is_main" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");