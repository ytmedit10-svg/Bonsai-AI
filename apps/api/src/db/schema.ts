import { sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
};

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    email: text("email").notNull(),
    name: text("name"),
    ...timestamps
  },
  (table) => ({
    usersEmailUnique: uniqueIndex("users_email_unique").on(table.email)
  })
);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    status: text("status").notNull().default("active"),
    mainPathId: uuid("main_path_id").references((): AnyPgColumn => paths.id, {
      onDelete: "set null"
    }),
    pinnedAt: timestamp("pinned_at", { withTimezone: true }),
    ...timestamps
  },
  (table) => ({
    conversationsUserUpdatedIdx: index("conversations_user_updated_idx").on(
      table.userId,
      table.updatedAt
    )
  })
);

export const paths = pgTable(
  "paths",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    parentPathId: uuid("parent_path_id").references((): AnyPgColumn => paths.id, {
      onDelete: "set null"
    }),
    rootPathId: uuid("root_path_id").references((): AnyPgColumn => paths.id, {
      onDelete: "set null"
    }),
    splitFromMessageId: uuid("split_from_message_id"),
    splitBlockStartOffset: integer("split_block_start_offset"),
    splitBlockEndOffset: integer("split_block_end_offset"),
    splitBlockType: text("split_block_type"),
    splitFocusText: text("split_focus_text"),
    pathType: text("path_type").notNull().default("chat"),
    isMain: boolean("is_main").notNull().default(false),
    title: text("title").notNull(),
    depth: integer("depth").notNull().default(0),
    sortOrder: integer("sort_order").notNull().default(0),
    status: text("status").notNull().default("active"),
    ...timestamps
  },
  (table) => ({
    pathsConversationCreatedIdx: index("paths_conversation_created_idx").on(
      table.conversationId,
      table.createdAt
    ),
    pathsParentCreatedIdx: index("paths_parent_created_idx").on(
      table.parentPathId,
      table.createdAt
    ),
    pathsRootCreatedIdx: index("paths_root_created_idx").on(
      table.rootPathId,
      table.createdAt
    ),
    pathsOneMainPerConversation: uniqueIndex(
      "paths_one_main_path_per_conversation"
    )
      .on(table.conversationId)
      .where(sql`${table.isMain} = true`)
  })
);

export const conversationViewStates = pgTable("conversation_view_states", {
  conversationId: uuid("conversation_id")
    .primaryKey()
    .references(() => conversations.id, { onDelete: "cascade" }),
  lastActivePathId: uuid("last_active_path_id").references((): AnyPgColumn => paths.id, {
    onDelete: "set null"
  }),
  ...timestamps
});

export const conversationShares = pgTable(
  "conversation_shares",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps
  },
  (table) => ({
    conversationSharesConversationIdx: index("conversation_shares_conversation_idx").on(
      table.conversationId
    ),
    conversationSharesTokenUnique: uniqueIndex("conversation_shares_token_unique").on(
      table.token
    )
  })
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    pathId: uuid("path_id")
      .notNull()
      .references(() => paths.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    messageType: text("message_type").notNull().default("chat"),
    contentText: text("content_text").notNull(),
    contentJson: jsonb("content_json"),
    sequenceNo: integer("sequence_no").notNull(),
    createdBy: text("created_by").notNull(),
    modelProvider: text("model_provider"),
    modelName: text("model_name"),
    status: text("status").notNull().default("completed"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => ({
    messagesPathSequenceUnique: uniqueIndex("messages_path_sequence_unique").on(
      table.pathId,
      table.sequenceNo
    ),
    messagesConversationCreatedIdx: index("messages_conversation_created_idx").on(
      table.conversationId,
      table.createdAt
    )
  })
);

export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    pathId: uuid("path_id")
      .notNull()
      .references(() => paths.id, { onDelete: "cascade" }),
    messageId: uuid("message_id").references(() => messages.id, {
      onDelete: "set null"
    }),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    originalName: text("original_name").notNull(),
    mimeType: text("mime_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    kind: text("kind").notNull().default("file"),
    storageProvider: text("storage_provider").notNull().default("local"),
    storageKey: text("storage_key").notNull(),
    thumbnailStorageKey: text("thumbnail_storage_key"),
    status: text("status").notNull().default("uploaded"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => ({
    attachmentsConversationCreatedIdx: index(
      "attachments_conversation_created_idx"
    ).on(table.conversationId, table.createdAt),
    attachmentsMessageIdx: index("attachments_message_idx").on(table.messageId),
    attachmentsPathStatusIdx: index("attachments_path_status_idx").on(
      table.pathId,
      table.status
    ),
    attachmentsStorageKeyUnique: uniqueIndex("attachments_storage_key_unique").on(
      table.storageKey
    )
  })
);

export const pathSnapshots = pgTable(
  "path_snapshots",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    pathId: uuid("path_id")
      .notNull()
      .references(() => paths.id, { onDelete: "cascade" }),
    snapshotKind: text("snapshot_kind").notNull().default("split_memory"),
    sourcePathId: uuid("source_path_id")
      .notNull()
      .references(() => paths.id, { onDelete: "cascade" }),
    sourceMessageId: uuid("source_message_id").references(() => messages.id, {
      onDelete: "set null"
    }),
    versionNo: integer("version_no").notNull().default(1),
    snapshotText: text("snapshot_text").notNull(),
    snapshotJson: jsonb("snapshot_json"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => ({
    pathSnapshotsPathVersionIdx: index("path_snapshots_path_version_idx").on(
      table.pathId,
      table.versionNo
    ),
    pathSnapshotsSourceMessageIdx: index("path_snapshots_source_message_idx").on(
      table.sourceMessageId
    )
  })
);

export const memoryArtifacts = pgTable(
  "memory_artifacts",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    pathId: uuid("path_id")
      .notNull()
      .references(() => paths.id, { onDelete: "cascade" }),
    artifactType: text("artifact_type").notNull(),
    visibility: text("visibility").notNull().default("path"),
    contentText: text("content_text").notNull(),
    contentJson: jsonb("content_json"),
    originPathId: uuid("origin_path_id").references((): AnyPgColumn => paths.id, {
      onDelete: "set null"
    }),
    originMessageId: uuid("origin_message_id").references((): AnyPgColumn => messages.id, {
      onDelete: "set null"
    }),
    originMergeId: uuid("origin_merge_id"),
    tokenEstimate: integer("token_estimate"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => ({
    memoryArtifactsPathCreatedIdx: index("memory_artifacts_path_created_idx").on(
      table.pathId,
      table.createdAt
    ),
    memoryArtifactsConversationTypeCreatedIdx: index(
      "memory_artifacts_conversation_type_created_idx"
    ).on(table.conversationId, table.artifactType, table.createdAt)
  })
);

export const merges = pgTable(
  "merges",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    sourcePathId: uuid("source_path_id")
      .notNull()
      .references(() => paths.id, { onDelete: "cascade" }),
    targetPathId: uuid("target_path_id")
      .notNull()
      .references(() => paths.id, { onDelete: "cascade" }),
    mergeMode: text("merge_mode").notNull(),
    status: text("status").notNull().default("pending"),
    requestedByUserId: uuid("requested_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    resultArtifactId: uuid("result_artifact_id"),
    resultMessageId: uuid("result_message_id").references(() => messages.id, {
      onDelete: "set null"
    }),
    errorText: text("error_text"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true })
  },
  (table) => ({
    mergesSourceCreatedIdx: index("merges_source_created_idx").on(
      table.sourcePathId,
      table.createdAt
    ),
    mergesTargetCreatedIdx: index("merges_target_created_idx").on(
      table.targetPathId,
      table.createdAt
    ),
    mergesStatusCreatedIdx: index("merges_status_created_idx").on(
      table.status,
      table.createdAt
    )
  })
);

export const cacheRecords = pgTable(
  "cache_records",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "cascade"
    }),
    pathId: uuid("path_id").references(() => paths.id, {
      onDelete: "cascade"
    }),
    cacheKey: text("cache_key").notNull(),
    cacheScope: text("cache_scope").notNull(),
    modelName: text("model_name").notNull(),
    geminiCachedContentName: text("gemini_cached_content_name").notNull(),
    contentHash: text("content_hash").notNull(),
    tokenEstimate: integer("token_estimate"),
    ttlSeconds: integer("ttl_seconds").notNull(),
    status: text("status").notNull().default("active"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => ({
    cacheRecordsPathStatusExpiresIdx: index("cache_records_path_status_expires_idx").on(
      table.pathId,
      table.status,
      table.expiresAt
    ),
    cacheRecordsConversationStatusExpiresIdx: index(
      "cache_records_conversation_status_expires_idx"
    ).on(table.conversationId, table.status, table.expiresAt),
    cacheRecordsCacheKeyUnique: uniqueIndex("cache_records_cache_key_unique").on(
      table.cacheKey
    )
  })
);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    jobType: text("job_type").notNull(),
    status: text("status").notNull().default("queued"),
    dedupeKey: text("dedupe_key"),
    payloadJson: jsonb("payload_json"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    runAfter: timestamp("run_after", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    errorText: text("error_text"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => ({
    jobsDedupeStatusIdx: index("jobs_dedupe_status_idx").on(
      table.dedupeKey,
      table.status
    ),
    jobsLockedAtIdx: index("jobs_locked_at_idx").on(table.lockedAt),
    jobsStatusRunAfterIdx: index("jobs_status_run_after_idx").on(
      table.status,
      table.runAfter,
      table.createdAt
    )
  })
);

export const embeddingRecords = pgTable(
  "embedding_records",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    sourceType: text("source_type").notNull(),
    sourceId: uuid("source_id").notNull(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    pathId: uuid("path_id").references(() => paths.id, {
      onDelete: "cascade"
    }),
    visibility: text("visibility").notNull().default("conversation"),
    contentText: text("content_text").notNull(),
    contentHash: text("content_hash").notNull(),
    embeddingModel: text("embedding_model").notNull(),
    embeddingDimensions: integer("embedding_dimensions").notNull(),
    embeddingJson: jsonb("embedding_json").notNull(),
    tokenEstimate: integer("token_estimate"),
    metadataJson: jsonb("metadata_json"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => ({
    embeddingRecordsConversationPathIdx: index(
      "embedding_records_conversation_path_idx"
    ).on(table.conversationId, table.pathId),
    embeddingRecordsSourceIdx: index("embedding_records_source_idx").on(
      table.sourceType,
      table.sourceId
    ),
    embeddingRecordsSourceModelUnique: uniqueIndex(
      "embedding_records_source_model_unique"
    ).on(table.sourceType, table.sourceId, table.embeddingModel),
    embeddingRecordsVisibilityIdx: index("embedding_records_visibility_idx").on(
      table.visibility
    )
  })
);

export const modelRuns = pgTable(
  "model_runs",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    pathId: uuid("path_id")
      .notNull()
      .references(() => paths.id, { onDelete: "cascade" }),
    messageId: uuid("message_id").references(() => messages.id, {
      onDelete: "set null"
    }),
    mergeId: uuid("merge_id").references(() => merges.id, {
      onDelete: "set null"
    }),
    runType: text("run_type").notNull(),
    status: text("status").notNull().default("queued"),
    modelProvider: text("model_provider").notNull(),
    modelName: text("model_name").notNull(),
    cacheMode: text("cache_mode").notNull().default("none"),
    cacheRecordId: uuid("cache_record_id").references(() => cacheRecords.id, {
      onDelete: "set null"
    }),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    cachedTokens: integer("cached_tokens"),
    estimatedCostUsd: numeric("estimated_cost_usd", { precision: 12, scale: 6 }),
    latencyMs: integer("latency_ms"),
    requestPayloadJson: jsonb("request_payload_json"),
    responsePayloadJson: jsonb("response_payload_json"),
    errorText: text("error_text"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => ({
    modelRunsPathCreatedIdx: index("model_runs_path_created_idx").on(
      table.pathId,
      table.createdAt
    ),
    modelRunsStatusCreatedIdx: index("model_runs_status_created_idx").on(
      table.status,
      table.createdAt
    )
  })
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;

export type Path = typeof paths.$inferSelect;
export type NewPath = typeof paths.$inferInsert;

export type ConversationViewState = typeof conversationViewStates.$inferSelect;
export type NewConversationViewState = typeof conversationViewStates.$inferInsert;

export type ConversationShare = typeof conversationShares.$inferSelect;
export type NewConversationShare = typeof conversationShares.$inferInsert;

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;

export type Attachment = typeof attachments.$inferSelect;
export type NewAttachment = typeof attachments.$inferInsert;

export type PathSnapshot = typeof pathSnapshots.$inferSelect;
export type NewPathSnapshot = typeof pathSnapshots.$inferInsert;

export type MemoryArtifact = typeof memoryArtifacts.$inferSelect;
export type NewMemoryArtifact = typeof memoryArtifacts.$inferInsert;

export type Merge = typeof merges.$inferSelect;
export type NewMerge = typeof merges.$inferInsert;

export type CacheRecord = typeof cacheRecords.$inferSelect;
export type NewCacheRecord = typeof cacheRecords.$inferInsert;

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;

export type EmbeddingRecord = typeof embeddingRecords.$inferSelect;
export type NewEmbeddingRecord = typeof embeddingRecords.$inferInsert;

export type ModelRun = typeof modelRuns.$inferSelect;
export type NewModelRun = typeof modelRuns.$inferInsert;
