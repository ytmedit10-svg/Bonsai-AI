import { createHash } from "node:crypto";

import { and, asc, eq, inArray } from "drizzle-orm";

import { db } from "../db/client.js";
import {
  attachments,
  conversations,
  embeddingRecords,
  memoryArtifacts,
  messages,
  paths,
  pathSnapshots
} from "../db/schema.js";
import { embedText, getEmbeddingProfile } from "./embedding-adapter.js";
import { enqueueSingletonJob } from "./job-service.js";

export type EmbeddingSourceType =
  | "attachment_text"
  | "memory_artifact"
  | "merge_artifact"
  | "message"
  | "path_snapshot";

type EmbeddingSourceRecord = {
  contentText: string;
  conversationId: string;
  metadataJson: Record<string, unknown>;
  pathId: string | null;
  sourceId: string;
  sourceType: EmbeddingSourceType;
  title: string;
  visibility: string;
};

const APPROX_CHARS_PER_TOKEN = 4;
const MERGE_ARTIFACT_TYPES = new Set(["merge_summary", "merge_full"]);

const estimateTokenCount = (value: string) =>
  Math.max(1, Math.ceil(value.length / APPROX_CHARS_PER_TOKEN));

const hashContent = (content: string) =>
  createHash("sha256").update(content).digest("hex");

const normalizeContent = (content: string) => content.replace(/\s+/g, " ").trim();

const isMergeArtifactType = (artifactType: string) =>
  MERGE_ARTIFACT_TYPES.has(artifactType);

const getMessageEmbeddingSource = async (
  sourceId: string
): Promise<EmbeddingSourceRecord | null> => {
  const message = await db.query.messages.findFirst({
    where: eq(messages.id, sourceId)
  });

  if (!message || !message.contentText.trim()) {
    return null;
  }

  return {
    contentText: message.contentText,
    conversationId: message.conversationId,
    metadataJson: {
      messageType: message.messageType,
      role: message.role,
      sequenceNo: message.sequenceNo,
      status: message.status,
      title: `${message.role} message #${message.sequenceNo}`
    },
    pathId: message.pathId,
    sourceId: message.id,
    sourceType: "message",
    title: `${message.role} message`,
    visibility: "path"
  };
};

const getPathSnapshotEmbeddingSource = async (
  sourceId: string
): Promise<EmbeddingSourceRecord | null> => {
  const snapshot = await db.query.pathSnapshots.findFirst({
    where: eq(pathSnapshots.id, sourceId)
  });

  if (!snapshot || !snapshot.snapshotText.trim()) {
    return null;
  }

  const path = await db.query.paths.findFirst({
    columns: {
      conversationId: true
    },
    where: eq(paths.id, snapshot.pathId)
  });

  if (!path) {
    return null;
  }

  return {
    contentText: snapshot.snapshotText,
    conversationId: path.conversationId,
    metadataJson: {
      snapshotKind: snapshot.snapshotKind,
      sourceMessageId: snapshot.sourceMessageId,
      sourcePathId: snapshot.sourcePathId,
      title: "Branch snapshot",
      versionNo: snapshot.versionNo
    },
    pathId: snapshot.pathId,
    sourceId: snapshot.id,
    sourceType: "path_snapshot",
    title: "Branch snapshot",
    visibility: "path"
  };
};

const getMemoryArtifactEmbeddingSource = async (
  sourceId: string
): Promise<EmbeddingSourceRecord | null> => {
  const artifact = await db.query.memoryArtifacts.findFirst({
    where: eq(memoryArtifacts.id, sourceId)
  });

  if (!artifact || !artifact.contentText.trim()) {
    return null;
  }

  const sourceType = isMergeArtifactType(artifact.artifactType)
    ? "merge_artifact"
    : "memory_artifact";
  const title = artifact.artifactType.replace(/_/g, " ");

  return {
    contentText: artifact.contentText,
    conversationId: artifact.conversationId,
    metadataJson: {
      artifactType: artifact.artifactType,
      isActive: artifact.isActive,
      originMergeId: artifact.originMergeId,
      originMessageId: artifact.originMessageId,
      originPathId: artifact.originPathId,
      title
    },
    pathId: artifact.pathId,
    sourceId: artifact.id,
    sourceType,
    title,
    visibility: artifact.visibility
  };
};

const getAttachmentEmbeddingSource = async (
  sourceId: string
): Promise<EmbeddingSourceRecord | null> => {
  const attachment = await db.query.attachments.findFirst({
    where: eq(attachments.id, sourceId)
  });

  if (!attachment) {
    return null;
  }

  const contentText = [
    attachment.originalName,
    attachment.mimeType,
    attachment.kind
  ].join(" ");

  return {
    contentText,
    conversationId: attachment.conversationId,
    metadataJson: {
      byteSize: attachment.byteSize,
      kind: attachment.kind,
      mimeType: attachment.mimeType,
      title: attachment.originalName
    },
    pathId: attachment.pathId,
    sourceId: attachment.id,
    sourceType: "attachment_text",
    title: attachment.originalName,
    visibility: "path"
  };
};

export const getEmbeddingSourceRecord = async ({
  sourceId,
  sourceType
}: {
  sourceId: string;
  sourceType: EmbeddingSourceType;
}) => {
  if (sourceType === "message") {
    return getMessageEmbeddingSource(sourceId);
  }

  if (sourceType === "path_snapshot") {
    return getPathSnapshotEmbeddingSource(sourceId);
  }

  if (sourceType === "attachment_text") {
    return getAttachmentEmbeddingSource(sourceId);
  }

  return getMemoryArtifactEmbeddingSource(sourceId);
};

export const indexEmbeddingSource = async ({
  sourceId,
  sourceType
}: {
  sourceId: string;
  sourceType: EmbeddingSourceType;
}) => {
  const source = await getEmbeddingSourceRecord({
    sourceId,
    sourceType
  });

  if (!source) {
    return {
      indexed: false,
      reason: "source_not_found_or_empty" as const
    };
  }

  const contentText = normalizeContent(source.contentText);
  const contentHash = hashContent(contentText);
  const embedded = await embedText(contentText);

  const [record] = await db
    .insert(embeddingRecords)
    .values({
      contentHash,
      contentText,
      conversationId: source.conversationId,
      embeddingDimensions: embedded.dimensions,
      embeddingJson: embedded.vector,
      embeddingModel: embedded.model,
      metadataJson: {
        ...source.metadataJson,
        title: source.title
      },
      pathId: source.pathId,
      sourceId: source.sourceId,
      sourceType: source.sourceType,
      tokenEstimate: estimateTokenCount(contentText),
      updatedAt: new Date(),
      visibility: source.visibility
    })
    .onConflictDoUpdate({
      set: {
        contentHash,
        contentText,
        conversationId: source.conversationId,
        embeddingDimensions: embedded.dimensions,
        embeddingJson: embedded.vector,
        metadataJson: {
          ...source.metadataJson,
          title: source.title
        },
        pathId: source.pathId,
        tokenEstimate: estimateTokenCount(contentText),
        updatedAt: new Date(),
        visibility: source.visibility
      },
      target: [
        embeddingRecords.sourceType,
        embeddingRecords.sourceId,
        embeddingRecords.embeddingModel
      ]
    })
    .returning();

  return {
    indexed: true,
    record
  };
};

export const enqueueEmbeddingForSource = async ({
  sourceId,
  sourceType
}: {
  sourceId: string;
  sourceType: EmbeddingSourceType;
}) => {
  const profile = getEmbeddingProfile();

  return enqueueSingletonJob({
    dedupeKey: `semantic_embedding:${profile.model}:${sourceType}:${sourceId}`,
    jobType: "semantic_embedding",
    maxAttempts: 3,
    payloadJson: {
      sourceId,
      sourceType
    }
  });
};

export const processEmbeddingJob = async (payload: unknown) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("semantic_embedding job requires a payload.");
  }

  const sourceId = "sourceId" in payload ? payload.sourceId : null;
  const sourceType = "sourceType" in payload ? payload.sourceType : null;

  if (
    typeof sourceId !== "string" ||
    typeof sourceType !== "string" ||
    !["attachment_text", "memory_artifact", "merge_artifact", "message", "path_snapshot"].includes(
      sourceType
    )
  ) {
    throw new Error("semantic_embedding job requires sourceId and sourceType.");
  }

  return indexEmbeddingSource({
    sourceId,
    sourceType: sourceType as EmbeddingSourceType
  });
};

export const listConversationEmbeddingSources = async ({
  conversationId,
  userId
}: {
  conversationId: string;
  userId: string;
}) => {
  const conversation = await db.query.conversations.findFirst({
    where: and(eq(conversations.id, conversationId), eq(conversations.userId, userId))
  });

  if (!conversation) {
    return null;
  }

  const [conversationMessages, conversationSnapshots, artifacts, conversationAttachments] =
    await Promise.all([
      db.query.messages.findMany({
        columns: {
          id: true
        },
        orderBy: [asc(messages.createdAt)],
        where: and(
          eq(messages.conversationId, conversationId),
          inArray(messages.status, ["completed", "failed"])
        )
      }),
      db
        .select({
          id: pathSnapshots.id
        })
        .from(pathSnapshots)
        .innerJoin(paths, eq(paths.id, pathSnapshots.pathId))
        .where(eq(paths.conversationId, conversationId))
        .orderBy(asc(pathSnapshots.createdAt)),
      db.query.memoryArtifacts.findMany({
        columns: {
          artifactType: true,
          id: true
        },
        orderBy: [asc(memoryArtifacts.createdAt)],
        where: eq(memoryArtifacts.conversationId, conversationId)
      }),
      db.query.attachments.findMany({
        columns: {
          id: true
        },
        orderBy: [asc(attachments.createdAt)],
        where: eq(attachments.conversationId, conversationId)
      })
    ]);

  return [
    ...conversationMessages.map((message) => ({
      sourceId: message.id,
      sourceType: "message" as const
    })),
    ...conversationSnapshots.map((snapshot) => ({
      sourceId: snapshot.id,
      sourceType: "path_snapshot" as const
    })),
    ...artifacts.map((artifact) => ({
      sourceId: artifact.id,
      sourceType: isMergeArtifactType(artifact.artifactType)
        ? ("merge_artifact" as const)
        : ("memory_artifact" as const)
    })),
    ...conversationAttachments.map((attachment) => ({
      sourceId: attachment.id,
      sourceType: "attachment_text" as const
    }))
  ];
};

export const backfillConversationEmbeddings = async ({
  conversationId,
  userId
}: {
  conversationId: string;
  userId: string;
}) => {
  const sources = await listConversationEmbeddingSources({
    conversationId,
    userId
  });

  if (!sources) {
    return null;
  }

  let indexed = 0;
  let skipped = 0;

  for (const source of sources) {
    const result = await indexEmbeddingSource(source);

    if (result.indexed) {
      indexed += 1;
    } else {
      skipped += 1;
    }
  }

  return {
    indexed,
    skipped,
    total: sources.length
  };
};
