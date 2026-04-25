import { and, asc, desc, eq, max } from "drizzle-orm";

import { loadEnv } from "../config/env.js";
import { db } from "../db/client.js";
import { conversations, messages, paths } from "../db/schema.js";
import { getLatestPathSnapshot } from "./path-service.js";

const env = loadEnv();

type CreatePathMessageInput = {
  content: string;
  createdBy: string;
  pathId: string;
  userId: string;
};

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

  const recentMessages = await db.query.messages.findMany({
    where: eq(messages.pathId, pathId),
    orderBy: [desc(messages.sequenceNo), desc(messages.createdAt)],
    limit: env.MAX_RECENT_MESSAGES_PER_PATH
  });

  recentMessages.reverse();

  const snapshot = await getLatestPathSnapshot(pathId);

  return {
    path: pathRecord,
    snapshot,
    messages: recentMessages
  };
};

export const createPathMessage = async ({
  content,
  createdBy,
  pathId,
  userId
}: CreatePathMessageInput) => {
  return createStoredMessage({
    content,
    createdBy,
    pathId,
    role: "user",
    userId
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
  modelName: string;
  modelProvider: string;
  pathId: string;
  userId: string;
};

export const createAssistantMessage = async ({
  content,
  modelName,
  modelProvider,
  pathId,
  userId
}: CreateAssistantMessageInput) => {
  return createStoredMessage({
    content,
    createdBy: "assistant",
    modelName,
    modelProvider,
    pathId,
    role: "assistant",
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
