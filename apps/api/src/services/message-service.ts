import { and, asc, desc, eq, gt, lt, max } from "drizzle-orm";

import { loadEnv } from "../config/env.js";
import { db } from "../db/client.js";
import { conversations, messages, paths } from "../db/schema.js";
import {
  getCompactionCoveredEndSequenceNo,
  getLatestPathCompaction
} from "./compaction-service.js";
import { enqueueEmbeddingForSource } from "./embedding-service.js";
import { getLatestPathSnapshot } from "./path-service.js";

const env = loadEnv();

type CreatePathMessageInput = {
  content: string;
  contentJson?: Record<string, unknown> | null;
  createdBy: string;
  pathId: string;
  userId: string;
};

type UpdatePathMessageInput = {
  content: string;
  messageId: string;
  pathId: string;
  userId: string;
};

type UpdatePathAssistantMessageInput = UpdatePathMessageInput & {
  contentJsonPatch?: Record<string, unknown> | null;
  lineage?: {
    contextBundle?: Record<string, unknown> | null;
    modelRunId: string;
    sourceUserMessageId: string;
  };
  modelName: string;
  modelProvider: string;
  status?: string;
};

type SelectAssistantVariantInput = {
  messageId: string;
  pathId: string;
  userId: string;
  variantNo: number;
};

export class MessageEditRegenerationError extends Error {
  statusCode: 409 | 404;

  constructor(statusCode: 409 | 404, message: string) {
    super(message);
    this.name = "MessageEditRegenerationError";
    this.statusCode = statusCode;
  }
}

type CreateStoredMessageInput = {
  content: string;
  contentJson?: Record<string, unknown> | null;
  createdBy: string;
  messageType?: string;
  modelName?: string | null;
  modelProvider?: string | null;
  pathId: string;
  role: "assistant" | "system" | "tool" | "user";
  status?: string;
  userId: string;
};

type AssistantLineageVariant = {
  contentText: string;
  contextBundle?: Record<string, unknown> | null;
  createdAt: string;
  modelName: string | null;
  modelProvider: string | null;
  modelRunId?: string | null;
  sourceUserMessageId?: string | null;
  variantNo: number;
};

type AssistantLineage = {
  currentVariantNo: number;
  regeneratedFromMessageId?: string;
  sourceUserMessageId?: string;
  variantGroupId: string;
  variants: AssistantLineageVariant[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const enqueueMessageEmbedding = (messageId: string) => {
  void enqueueEmbeddingForSource({
    sourceId: messageId,
    sourceType: "message"
  }).catch(() => undefined);
};

export const getAssistantLineage = (value: unknown): AssistantLineage | null => {
  if (!isRecord(value) || !isRecord(value.lineage)) {
    return null;
  }

  const lineage = value.lineage;

  if (
    typeof lineage.variantGroupId !== "string" ||
    typeof lineage.currentVariantNo !== "number" ||
    !Array.isArray(lineage.variants)
  ) {
    return null;
  }

  return lineage as AssistantLineage;
};

export const buildRegeneratedAssistantContentJson = ({
  content,
  contextBundle,
  existingContentJson,
  existingMessage,
  messageId,
  modelName,
  modelProvider,
  modelRunId,
  sourceUserMessageId
}: {
  content: string;
  contextBundle?: Record<string, unknown> | null;
  existingContentJson: unknown;
  existingMessage: {
    contentText: string;
    createdAt: Date;
    modelName: string | null;
    modelProvider: string | null;
  };
  messageId: string;
  modelName: string;
  modelProvider: string;
  modelRunId: string;
  sourceUserMessageId: string;
}) => {
  const baseJson = isRecord(existingContentJson) ? existingContentJson : {};
  const existingLineage = getAssistantLineage(baseJson);
  const now = new Date().toISOString();
  const variants = existingLineage
    ? [...existingLineage.variants]
    : [
        {
          contentText: existingMessage.contentText,
          createdAt: existingMessage.createdAt.toISOString(),
          modelName: existingMessage.modelName,
          modelProvider: existingMessage.modelProvider,
          modelRunId: null,
          sourceUserMessageId,
          variantNo: 1
        }
      ];
  const nextVariantNo =
    variants.reduce(
      (highest, variant) =>
        typeof variant.variantNo === "number"
          ? Math.max(highest, variant.variantNo)
          : highest,
      0
    ) + 1;

  variants.push({
    contentText: content,
    contextBundle: contextBundle ?? null,
    createdAt: now,
    modelName,
    modelProvider,
    modelRunId,
    sourceUserMessageId,
    variantNo: nextVariantNo
  });

  return {
    ...baseJson,
    lineage: {
      currentVariantNo: nextVariantNo,
      regeneratedFromMessageId: messageId,
      sourceUserMessageId,
      variantGroupId: existingLineage?.variantGroupId ?? crypto.randomUUID(),
      variants
    } satisfies AssistantLineage
  };
};

export const buildSelectedAssistantVariantContentJson = ({
  existingContentJson,
  variantNo
}: {
  existingContentJson: unknown;
  variantNo: number;
}) => {
  const baseJson = isRecord(existingContentJson) ? existingContentJson : {};
  const lineage = getAssistantLineage(baseJson);
  const selectedVariant = lineage?.variants.find(
    (variant) => variant.variantNo === variantNo
  );

  if (!lineage || !selectedVariant) {
    return null;
  }

  return {
    contentJson: {
      ...baseJson,
      lineage: {
        ...lineage,
        currentVariantNo: variantNo
      }
    },
    selectedVariant
  };
};

export const getPathForUser = async (pathId: string, userId: string) => {
  return db
    .select({
      conversationId: paths.conversationId,
      depth: paths.depth,
      isMain: paths.isMain,
      parentPathId: paths.parentPathId,
      pathId: paths.id,
      pathTitle: paths.title,
      splitFromMessageId: paths.splitFromMessageId,
      splitBlockStartOffset: paths.splitBlockStartOffset,
      splitBlockEndOffset: paths.splitBlockEndOffset,
      splitBlockType: paths.splitBlockType,
      splitFocusText: paths.splitFocusText
    })
    .from(paths)
    .innerJoin(conversations, eq(paths.conversationId, conversations.id))
    .where(and(eq(paths.id, pathId), eq(conversations.userId, userId)))
    .limit(1)
    .then((rows) => rows[0] ?? null);
};

const buildMessagePreview = (content: string, limit = 180) => {
  const normalized = content.replace(/\s+/g, " ").trim();

  if (normalized.length <= limit) {
    return normalized;
  }

  return `${normalized.slice(0, limit)}...`;
};

const getPathProvenance = async (pathRecord: NonNullable<Awaited<ReturnType<typeof getPathForUser>>>) => {
  if (pathRecord.isMain || !pathRecord.parentPathId || !pathRecord.splitFromMessageId) {
    return {
      parentPath: null,
      splitMessage: null
    };
  }

  const [parentPath, splitMessage] = await Promise.all([
    db.query.paths.findFirst({
      columns: {
        id: true,
        title: true
      },
      where: eq(paths.id, pathRecord.parentPathId)
    }),
    db.query.messages.findFirst({
      columns: {
        createdAt: true,
        id: true,
        role: true,
        sequenceNo: true,
        contentText: true
      },
      where: eq(messages.id, pathRecord.splitFromMessageId)
    })
  ]);

  return {
    parentPath:
      parentPath ?? null,
    splitMessage: splitMessage
      ? {
          createdAt: splitMessage.createdAt,
          id: splitMessage.id,
          role: splitMessage.role,
          sequenceNo: splitMessage.sequenceNo,
          contentPreview: buildMessagePreview(splitMessage.contentText),
          splitBlockStartOffset: pathRecord.splitBlockStartOffset,
          splitBlockEndOffset: pathRecord.splitBlockEndOffset,
          splitBlockType: pathRecord.splitBlockType,
          splitFocusText: pathRecord.splitFocusText
        }
      : null
  };
};

export const listPathMessages = async (pathId: string, userId: string) => {
  const pathRecord = await getPathForUser(pathId, userId);

  if (!pathRecord) {
    return null;
  }

  const pathMessages = await db.query.messages.findMany({
    where: eq(messages.pathId, pathId),
    orderBy: [asc(messages.sequenceNo), asc(messages.createdAt)]
  });

  const snapshot = await getLatestPathSnapshot(pathId);
  const provenance = await getPathProvenance(pathRecord);

  return {
    path: pathRecord,
    provenance,
    snapshot,
    messages: pathMessages
  };
};

export const getRecentPathMessagesForGeneration = async (
  pathId: string,
  userId: string
) => {
  const pathRecord = await getPathForUser(pathId, userId);

  if (!pathRecord) {
    return null;
  }

  const compaction = await getLatestPathCompaction(pathId);
  const coveredEndSequenceNo = getCompactionCoveredEndSequenceNo(compaction);
  const messageWhere =
    coveredEndSequenceNo > 0
      ? and(eq(messages.pathId, pathId), gt(messages.sequenceNo, coveredEndSequenceNo))
      : eq(messages.pathId, pathId);

  const recentMessages = await db.query.messages.findMany({
    where: messageWhere,
    orderBy: [desc(messages.sequenceNo), desc(messages.createdAt)],
    limit: env.MAX_RECENT_MESSAGES_PER_PATH
  });

  recentMessages.reverse();

  const snapshot = await getLatestPathSnapshot(pathId);

  return {
    path: pathRecord,
    compaction,
    snapshot,
    messages: recentMessages
  };
};

export const getPathMessagesBeforeAssistantForRegeneration = async (
  pathId: string,
  messageId: string,
  userId: string
) => {
  const pathRecord = await getPathForUser(pathId, userId);

  if (!pathRecord) {
    return null;
  }

  const targetMessage = await db.query.messages.findFirst({
    where: and(
      eq(messages.id, messageId),
      eq(messages.pathId, pathId),
      eq(messages.role, "assistant")
    )
  });

  if (!targetMessage) {
    return null;
  }

  const compaction = await getLatestPathCompaction(pathId);
  const coveredEndSequenceNo = getCompactionCoveredEndSequenceNo(compaction);
  const usableCompaction =
    coveredEndSequenceNo > 0 && coveredEndSequenceNo < targetMessage.sequenceNo
      ? compaction
      : null;
  const messageWhere = usableCompaction
    ? and(
        eq(messages.pathId, pathId),
        gt(messages.sequenceNo, coveredEndSequenceNo),
        lt(messages.sequenceNo, targetMessage.sequenceNo)
      )
    : and(
        eq(messages.pathId, pathId),
        lt(messages.sequenceNo, targetMessage.sequenceNo)
      );

  const recentMessages = await db.query.messages.findMany({
    where: messageWhere,
    orderBy: [desc(messages.sequenceNo), desc(messages.createdAt)],
    limit: env.MAX_RECENT_MESSAGES_PER_PATH
  });

  recentMessages.reverse();

  const sourceUserMessage = [...recentMessages]
    .reverse()
    .find((message) => message.role === "user") ?? null;

  if (!sourceUserMessage) {
    return null;
  }

  const snapshot = await getLatestPathSnapshot(pathId);

  return {
    path: pathRecord,
    compaction: usableCompaction,
    snapshot,
    messages: recentMessages,
    sourceUserMessage
  };
};

export const createPathMessage = async ({
  content,
  contentJson,
  createdBy,
  pathId,
  userId
}: CreatePathMessageInput) => {
  return createStoredMessage({
    content,
    contentJson,
    createdBy,
    pathId,
    role: "user",
    userId
  });
};

export const updatePathUserMessage = async ({
  content,
  messageId,
  pathId,
  userId
}: UpdatePathMessageInput) => {
  const pathRecord = await getPathForUser(pathId, userId);

  if (!pathRecord) {
    return null;
  }

  return db.transaction(async (tx) => {
    const [message] = await tx
      .update(messages)
      .set({
        contentText: content
      })
      .where(
        and(
          eq(messages.id, messageId),
          eq(messages.pathId, pathId),
          eq(messages.role, "user")
        )
      )
      .returning();

    if (!message) {
      return null;
    }

    enqueueMessageEmbedding(message.id);

    await tx
      .update(paths)
      .set({
        updatedAt: new Date()
      })
      .where(eq(paths.id, pathId));

    await tx
      .update(conversations)
      .set({
        updatedAt: new Date()
      })
      .where(eq(conversations.id, pathRecord.conversationId));

    return {
      path: pathRecord,
      message
    };
  });
};

export const updateLatestUserMessageForRegeneration = async ({
  content,
  messageId,
  pathId,
  userId
}: UpdatePathMessageInput) => {
  const pathRecord = await getPathForUser(pathId, userId);

  if (!pathRecord) {
    return null;
  }

  return db.transaction(async (tx) => {
    const targetMessage = await tx.query.messages.findFirst({
      where: and(
        eq(messages.id, messageId),
        eq(messages.pathId, pathId),
        eq(messages.role, "user")
      )
    });

    if (!targetMessage) {
      return null;
    }

    if (targetMessage.messageType !== "chat") {
      throw new MessageEditRegenerationError(
        409,
        "Only chat user messages can be edited and regenerated."
      );
    }

    const latestUserMessage = await tx.query.messages.findFirst({
      where: and(
        eq(messages.pathId, pathId),
        eq(messages.role, "user"),
        eq(messages.messageType, "chat")
      ),
      orderBy: [desc(messages.sequenceNo), desc(messages.createdAt)]
    });

    if (latestUserMessage?.id !== targetMessage.id) {
      throw new MessageEditRegenerationError(
        409,
        "Only the latest user message can be edited and regenerated."
      );
    }

    const followingMessage = await tx.query.messages.findFirst({
      where: and(
        eq(messages.pathId, pathId),
        gt(messages.sequenceNo, targetMessage.sequenceNo)
      ),
      orderBy: [asc(messages.sequenceNo), asc(messages.createdAt)]
    });

    if (
      !followingMessage ||
      followingMessage.role !== "assistant" ||
      followingMessage.messageType !== "chat"
    ) {
      throw new MessageEditRegenerationError(
        409,
        "The latest user message does not have an assistant response to regenerate."
      );
    }

    const [message] = await tx
      .update(messages)
      .set({
        contentText: content,
        status: "completed"
      })
      .where(
        and(
          eq(messages.id, messageId),
          eq(messages.pathId, pathId),
          eq(messages.role, "user")
        )
      )
      .returning();

    if (!message) {
      return null;
    }

    enqueueMessageEmbedding(message.id);

    await tx
      .update(paths)
      .set({
        updatedAt: new Date()
      })
      .where(eq(paths.id, pathId));

    await tx
      .update(conversations)
      .set({
        updatedAt: new Date()
      })
      .where(eq(conversations.id, pathRecord.conversationId));

    return {
      assistantMessage: followingMessage,
      path: pathRecord,
      userMessage: message
    };
  });
};

export const updatePathAssistantMessage = async ({
  content,
  contentJsonPatch = null,
  lineage,
  messageId,
  modelName,
  modelProvider,
  pathId,
  status,
  userId
}: UpdatePathAssistantMessageInput) => {
  const pathRecord = await getPathForUser(pathId, userId);

  if (!pathRecord) {
    return null;
  }

  return db.transaction(async (tx) => {
    const existingMessage = await tx.query.messages.findFirst({
      where: and(
        eq(messages.id, messageId),
        eq(messages.pathId, pathId),
        eq(messages.role, "assistant")
      )
    });

    if (!existingMessage) {
      return null;
    }

    const baseContentJson = lineage
      ? buildRegeneratedAssistantContentJson({
          content,
          contextBundle: lineage.contextBundle,
          existingContentJson: existingMessage.contentJson,
          existingMessage,
          messageId,
          modelName,
          modelProvider,
          modelRunId: lineage.modelRunId,
          sourceUserMessageId: lineage.sourceUserMessageId
        })
      : existingMessage.contentJson;
    const nextContentJson = contentJsonPatch
      ? {
          ...(isRecord(baseContentJson) ? baseContentJson : {}),
          ...contentJsonPatch
        }
      : baseContentJson;

    const [message] = await tx
      .update(messages)
      .set({
        contentText: content,
        contentJson: nextContentJson,
        modelName,
        modelProvider,
        ...(status ? { status } : {})
      })
      .where(
        and(
          eq(messages.id, messageId),
          eq(messages.pathId, pathId),
          eq(messages.role, "assistant")
        )
      )
      .returning();

    if (!message) {
      return null;
    }

    enqueueMessageEmbedding(message.id);

    await tx
      .update(paths)
      .set({
        updatedAt: new Date()
      })
      .where(eq(paths.id, pathId));

    await tx
      .update(conversations)
      .set({
        updatedAt: new Date()
      })
      .where(eq(conversations.id, pathRecord.conversationId));

    return {
      path: pathRecord,
      message
    };
  });
};

export const selectPathAssistantMessageVariant = async ({
  messageId,
  pathId,
  userId,
  variantNo
}: SelectAssistantVariantInput) => {
  const pathRecord = await getPathForUser(pathId, userId);

  if (!pathRecord) {
    return null;
  }

  return db.transaction(async (tx) => {
    const existingMessage = await tx.query.messages.findFirst({
      where: and(
        eq(messages.id, messageId),
        eq(messages.pathId, pathId),
        eq(messages.role, "assistant")
      )
    });

    if (!existingMessage) {
      return null;
    }

    const selected = buildSelectedAssistantVariantContentJson({
      existingContentJson: existingMessage.contentJson,
      variantNo
    });

    if (!selected) {
      return null;
    }

    const [message] = await tx
      .update(messages)
      .set({
        contentJson: selected.contentJson,
        contentText: selected.selectedVariant.contentText,
        modelName: selected.selectedVariant.modelName,
        modelProvider: selected.selectedVariant.modelProvider
      })
      .where(
        and(
          eq(messages.id, messageId),
          eq(messages.pathId, pathId),
          eq(messages.role, "assistant")
        )
      )
      .returning();

    if (message) {
      enqueueMessageEmbedding(message.id);
    }

    return {
      path: pathRecord,
      message
    };
  });
};

const createStoredMessage = async ({
  content,
  contentJson,
  createdBy,
  messageType = "chat",
  modelName = null,
  modelProvider = null,
  pathId,
  role,
  status = "completed",
  userId
}: CreateStoredMessageInput) => {
  const pathRecord = await getPathForUser(pathId, userId);

  if (!pathRecord) {
    return null;
  }

  return db.transaction(async (tx) => {
    const [sequenceRow] = await tx
      .select({
        currentSequence: max(messages.sequenceNo)
      })
      .from(messages)
      .where(eq(messages.pathId, pathId));

    const nextSequence = (sequenceRow?.currentSequence ?? 0) + 1;

    const [message] = await tx
      .insert(messages)
      .values({
        contentText: content,
        contentJson: contentJson ?? null,
        conversationId: pathRecord.conversationId,
        createdBy,
        messageType,
        modelName,
        modelProvider,
        pathId,
        role,
        sequenceNo: nextSequence,
        status
      })
      .returning();

    enqueueMessageEmbedding(message.id);

    await tx
      .update(paths)
      .set({
        updatedAt: new Date()
      })
      .where(eq(paths.id, pathId));

    await tx
      .update(conversations)
      .set({
        updatedAt: new Date()
      })
      .where(eq(conversations.id, pathRecord.conversationId));

    return {
      path: pathRecord,
      message
    };
  });
};

type CreateAssistantMessageInput = {
  content: string;
  contentJson?: Record<string, unknown> | null;
  modelName: string;
  modelProvider: string;
  pathId: string;
  status?: string;
  userId: string;
};

export const createAssistantMessage = async ({
  content,
  contentJson = null,
  modelName,
  modelProvider,
  pathId,
  status,
  userId
}: CreateAssistantMessageInput) => {
  return createStoredMessage({
    content,
    contentJson,
    createdBy: "assistant",
    modelName,
    modelProvider,
    pathId,
    role: "assistant",
    status,
    userId
  });
};

type CreateMergeMemoryMessageInput = {
  artifactId: string;
  content: string;
  mergeId: string;
  mergeMode: string;
  modelName: string;
  modelProvider: string;
  pathId: string;
  sourcePathId: string;
  sourcePathTitle: string;
  userId: string;
};

export const createMergeMemoryMessage = async ({
  artifactId,
  content,
  mergeId,
  mergeMode,
  modelName,
  modelProvider,
  pathId,
  sourcePathId,
  sourcePathTitle,
  userId
}: CreateMergeMemoryMessageInput) => {
  return createStoredMessage({
    content,
    contentJson: {
      artifactId,
      mergeId,
      mergeMode,
      sourcePathId,
      sourcePathTitle
    },
    createdBy: "merge",
    messageType: "merge_memory",
    modelName,
    modelProvider,
    pathId,
    role: "assistant",
    userId
  });
};
