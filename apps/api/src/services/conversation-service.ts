import { randomBytes } from "node:crypto";

import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";

import { db } from "../db/client.js";
import { conversationShares, conversations, messages, paths } from "../db/schema.js";

type CreateConversationInput = {
  title: string;
  userId: string;
};

type UpdateConversationInput = {
  conversationId: string;
  pinned?: boolean;
  title?: string;
  userId: string;
};

const ACTIVE_STATUS = "active";

const createShareToken = () => randomBytes(24).toString("base64url");

const buildMessagePreview = (content: string, limit = 96) => {
  const normalized = content.replace(/\s+/g, " ").trim();

  if (normalized.length <= limit) {
    return normalized;
  }

  return `${normalized.slice(0, limit).trimEnd()}...`;
};

export const createConversationWithMainPath = async ({
  title,
  userId
}: CreateConversationInput) => {
  return db.transaction(async (tx) => {
    const [conversation] = await tx
      .insert(conversations)
      .values({
        title,
        userId
      })
      .returning();

    const [mainPath] = await tx
      .insert(paths)
      .values({
        conversationId: conversation.id,
        title: "Main Path",
        isMain: true,
        pathType: "chat"
      })
      .returning();

    const [updatedMainPath] = await tx
      .update(paths)
      .set({
        rootPathId: mainPath.id
      })
      .where(eq(paths.id, mainPath.id))
      .returning();

    const [updatedConversation] = await tx
      .update(conversations)
      .set({
        mainPathId: updatedMainPath.id
      })
      .where(eq(conversations.id, conversation.id))
      .returning();

    return {
      conversation: updatedConversation,
      mainPath: updatedMainPath
    };
  });
};

export const getConversationSummary = async (
  conversationId: string,
  userId: string
) => {
  const conversation = await db.query.conversations.findFirst({
    where: and(
      eq(conversations.id, conversationId),
      eq(conversations.userId, userId),
      eq(conversations.status, ACTIVE_STATUS)
    )
  });

  if (!conversation) {
    return null;
  }

  const conversationPaths = await db.query.paths.findMany({
    where: eq(paths.conversationId, conversationId),
    orderBy: [paths.createdAt]
  });

  const latestMessages = await db.query.messages.findMany({
    where: eq(messages.conversationId, conversationId),
    orderBy: [desc(messages.createdAt)],
    limit: 10
  });

  return {
    conversation,
    paths: conversationPaths,
    latestMessages
  };
};

export const listConversationsForUser = async (userId: string) => {
  const rows = await db
    .select({
      conversation: conversations,
      latestMessageCreatedAt: sql<Date | null>`max(${messages.createdAt})`,
      latestMessagePreview: sql<string | null>`(
        array_agg(${messages.contentText} order by ${messages.createdAt} desc)
      )[1]`
    })
    .from(conversations)
    .leftJoin(messages, eq(messages.conversationId, conversations.id))
    .where(and(eq(conversations.userId, userId), eq(conversations.status, ACTIVE_STATUS)))
    .groupBy(conversations.id)
    .orderBy(
      sql`case when ${conversations.pinnedAt} is null then 1 else 0 end`,
      desc(conversations.pinnedAt),
      desc(conversations.updatedAt)
    );

  return {
    conversations: rows.map((row) => ({
      conversationId: row.conversation.id,
      mainPathId: row.conversation.mainPathId,
      pinnedAt: row.conversation.pinnedAt?.toISOString() ?? null,
      preview: row.latestMessagePreview
        ? buildMessagePreview(row.latestMessagePreview)
        : "Start the conversation to generate a title.",
      title: row.conversation.title,
      updatedAt: (
        row.latestMessageCreatedAt ?? row.conversation.updatedAt
      ).toISOString()
    }))
  };
};

export const updateConversation = async ({
  conversationId,
  pinned,
  title,
  userId
}: UpdateConversationInput) => {
  const updateValues: Partial<{
    pinnedAt: Date | null;
    title: string;
    updatedAt: Date;
  }> = {
    updatedAt: new Date()
  };

  if (typeof title === "string") {
    updateValues.title = title;
  }

  if (typeof pinned === "boolean") {
    updateValues.pinnedAt = pinned ? new Date() : null;
  }

  const [conversation] = await db
    .update(conversations)
    .set(updateValues)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.userId, userId),
        eq(conversations.status, ACTIVE_STATUS)
      )
    )
    .returning();

  return conversation ?? null;
};

export const deleteConversation = async (
  conversationId: string,
  userId: string
) => {
  const [conversation] = await db
    .delete(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.userId, userId),
        eq(conversations.status, ACTIVE_STATUS)
      )
    )
    .returning({
      id: conversations.id
    });

  return conversation ?? null;
};

export const createOrGetConversationShare = async (
  conversationId: string,
  userId: string
) => {
  const conversation = await db.query.conversations.findFirst({
    where: and(
      eq(conversations.id, conversationId),
      eq(conversations.userId, userId),
      eq(conversations.status, ACTIVE_STATUS)
    )
  });

  if (!conversation) {
    return null;
  }

  const existingShare = await db.query.conversationShares.findFirst({
    where: and(
      eq(conversationShares.conversationId, conversationId),
      isNull(conversationShares.revokedAt)
    ),
    orderBy: [desc(conversationShares.createdAt)]
  });

  if (existingShare) {
    return {
      conversation,
      share: existingShare
    };
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const [share] = await db
        .insert(conversationShares)
        .values({
          conversationId,
          token: createShareToken()
        })
        .returning();

      return {
        conversation,
        share
      };
    } catch (error) {
      if (attempt === 2) {
        throw error;
      }
    }
  }

  return null;
};

export const getSharedConversation = async (token: string) => {
  const share = await db.query.conversationShares.findFirst({
    where: and(eq(conversationShares.token, token), isNull(conversationShares.revokedAt))
  });

  if (!share) {
    return null;
  }

  const conversation = await db.query.conversations.findFirst({
    where: and(
      eq(conversations.id, share.conversationId),
      eq(conversations.status, ACTIVE_STATUS)
    )
  });

  if (!conversation) {
    return null;
  }

  const conversationPaths = await db
    .select({
      id: paths.id,
      conversationId: paths.conversationId,
      parentPathId: paths.parentPathId,
      rootPathId: paths.rootPathId,
      splitFromMessageId: paths.splitFromMessageId,
      splitBlockStartOffset: paths.splitBlockStartOffset,
      splitBlockEndOffset: paths.splitBlockEndOffset,
      splitBlockType: paths.splitBlockType,
      splitFocusText: paths.splitFocusText,
      pathType: paths.pathType,
      isMain: paths.isMain,
      title: paths.title,
      depth: paths.depth,
      sortOrder: paths.sortOrder,
      status: paths.status,
      createdAt: paths.createdAt,
      updatedAt: paths.updatedAt,
      splitMessageSequenceNo: messages.sequenceNo,
      splitMessageCreatedAt: messages.createdAt,
      splitMessagePreview: messages.contentText
    })
    .from(paths)
    .leftJoin(messages, eq(paths.splitFromMessageId, messages.id))
    .where(eq(paths.conversationId, conversation.id))
    .orderBy(asc(paths.depth), asc(paths.createdAt))
    .then((rows) =>
      rows.map((row) => ({
        ...row,
        splitMessageCreatedAt: row.splitMessageCreatedAt?.toISOString() ?? null,
        splitMessagePreview:
          row.splitFocusText ??
          (row.splitMessagePreview ? buildMessagePreview(row.splitMessagePreview, 160) : null)
      }))
    );

  const conversationMessages = await db.query.messages.findMany({
    where: eq(messages.conversationId, conversation.id),
    orderBy: [asc(messages.pathId), asc(messages.sequenceNo), asc(messages.createdAt)]
  });

  return {
    conversation,
    messagesByPathId: conversationMessages.reduce<Record<string, typeof conversationMessages>>(
      (accumulator, message) => {
        accumulator[message.pathId] = [...(accumulator[message.pathId] ?? []), message];
        return accumulator;
      },
      {}
    ),
    paths: conversationPaths,
    share: {
      createdAt: share.createdAt,
      token: share.token
    }
  };
};
