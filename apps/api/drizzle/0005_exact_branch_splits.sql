ALTER TABLE "paths" ADD COLUMN "split_block_start_offset" integer;--> statement-breakpoint
ALTER TABLE "paths" ADD COLUMN "split_block_end_offset" integer;--> statement-breakpoint
ALTER TABLE "paths" ADD COLUMN "split_block_type" text;--> statement-breakpoint
ALTER TABLE "paths" ADD COLUMN "split_focus_text" text;
