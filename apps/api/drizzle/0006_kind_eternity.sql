CREATE TABLE "conversation_view_states" (
	"conversation_id" uuid PRIMARY KEY NOT NULL,
	"last_active_path_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversation_view_states" ADD CONSTRAINT "conversation_view_states_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_view_states" ADD CONSTRAINT "conversation_view_states_last_active_path_id_paths_id_fk" FOREIGN KEY ("last_active_path_id") REFERENCES "public"."paths"("id") ON DELETE set null ON UPDATE no action;
