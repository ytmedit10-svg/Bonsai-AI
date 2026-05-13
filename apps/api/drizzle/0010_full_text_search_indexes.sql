CREATE INDEX "conversations_search_idx" ON "conversations" USING gin (to_tsvector('english', coalesce("title", '')));--> statement-breakpoint
CREATE INDEX "paths_search_idx" ON "paths" USING gin (to_tsvector('english', coalesce("title", '') || ' ' || coalesce("split_focus_text", '')));--> statement-breakpoint
CREATE INDEX "messages_search_idx" ON "messages" USING gin (to_tsvector('english', coalesce("content_text", '')));--> statement-breakpoint
CREATE INDEX "path_snapshots_search_idx" ON "path_snapshots" USING gin (to_tsvector('english', coalesce("snapshot_text", '')));--> statement-breakpoint
CREATE INDEX "memory_artifacts_search_idx" ON "memory_artifacts" USING gin (to_tsvector('english', coalesce("content_text", '')));--> statement-breakpoint
CREATE INDEX "attachments_search_idx" ON "attachments" USING gin (to_tsvector('english', coalesce("original_name", '') || ' ' || coalesce("mime_type", '') || ' ' || coalesce("kind", '')));
