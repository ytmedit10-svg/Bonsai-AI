import { and, asc, desc, eq, lt } from "drizzle-orm";

import { db } from "../db/client.js";
import {
  conversations,
  messages,
  paths,
  pathSnapshots,
  type Message
} from "../db/schema.js";

type CreateBranchInput = {
  splitBlockEndOffset: number;
  splitBlockStartOffset: number;
  splitBlockType: string;
  pathType: string;
  splitFocusText: string;
  sourcePathId: string;
  splitFromMessageId: string;
  title?: string | null;
  userId: string;
};

const formatSnapshotText = ({
  history,
  sourcePathTitle,
  splitBlockType,
  splitFocusText,
  splitSequenceNo
}: {
  history: Array<Pick<Message, "contentText" | "role">>;
  sourcePathTitle: string;
  splitBlockType: string;
  splitFocusText: string;
  splitSequenceNo: number;
}) => {
  const transcript = history
    .map((message) => `${message.role.toUpperCase()}: ${message.contentText}`)
    .join("\n\n");

  return [
    `Inherited branch snapshot from path "${sourcePathTitle}".`,
    `This branch was split inside message sequence ${splitSequenceNo} at a ${splitBlockType} block.`,
    `Clicked block: ${splitFocusText}`,
    "Use this as inherited memory context for the branch. Do not assume newer parent-path messages exist unless they appear in this branch later.",
    "",
    transcript
  ].join("\n");
};

const buildPartialSplitMessage = (
  splitMessage: Message,
  splitBlockEndOffset: number
) => ({
  ...splitMessage,
  contentText: splitMessage.contentText.slice(0, splitBlockEndOffset).trimEnd()
});

const createDefaultBranchTitle = ({
  parentTitle,
  splitSequenceNo
}: {
  parentTitle: string;
  splitSequenceNo: number;
}) => {
  return `${parentTitle} Branch ${splitSequenceNo}`;
};

const buildMessagePreview = (content: string, limit = 160) => {
  const normalized = content.replace(/\s+/g, " ").trim();

  if (normalized.length <= limit) {
    return normalized;
  }

  return `${normalized.slice(0, limit).trimEnd()}...`;
};

const normalizeComparableBlockText = (value: string) =>
  value
    .replace(/[`*_#[\]()>\-+|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

export const listConversationPaths = async (
  conversationId: string,
  userId: string
) => {
  const conversation = await db.query.conversations.findFirst({
    where: and(
      eq(conversations.id, conversationId),
      eq(conversations.userId, userId)
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
    .where(eq(paths.conversationId, conversationId))
    .orderBy(asc(paths.depth), asc(paths.createdAt))
    .then((rows) =>
      rows.map((row) => ({
        ...row,
        splitMessageCreatedAt: row.splitMessageCreatedAt?.toISOString() ?? null,
        splitMessagePreview:
          row.splitFocusText ??
          (row.splitMessagePreview
            ? buildMessagePreview(row.splitMessagePreview)
            : null)
      }))
    );

  return {
    conversation,
    paths: conversationPaths
  };
};

export const getLatestPathSnapshot = async (pathId: string) => {
  return db.query.pathSnapshots.findFirst({
    where: eq(pathSnapshots.pathId, pathId),
    orderBy: [desc(pathSnapshots.versionNo), desc(pathSnapshots.createdAt)]
  });
};

export const createBranchFromMessage = async ({
  splitBlockEndOffset,
  splitBlockStartOffset,
  splitBlockType,
  splitFocusText,
  pathType,
  sourcePathId,
  splitFromMessageId,
  title,
  userId
}: CreateBranchInput) => {
  const sourcePath = await db
    .select({
      conversationId: paths.conversationId,
      depth: paths.depth,
      id: paths.id,
      rootPathId: paths.rootPathId,
      title: paths.title
    })
    .from(paths)
    .innerJoin(conversations, eq(paths.conversationId, conversations.id))
    .where(and(eq(paths.id, sourcePathId), eq(conversations.userId, userId)))
    .limit(1)
    .then((rows) => rows[0] ?? null);

  if (!sourcePath) {
    return null;
  }

  const splitMessage = await db.query.messages.findFirst({
    where: and(
      eq(messages.id, splitFromMessageId),
      eq(messages.pathId, sourcePathId)
    )
  });

  if (!splitMessage) {
    return {
      error: "Split message not found on the selected path."
    } as const;
  }

  const normalizedFocusText = splitFocusText.replace(/\s+/g, " ").trim();

  if (
    splitBlockStartOffset < 0 ||
    splitBlockEndOffset <= splitBlockStartOffset ||
    splitBlockEndOffset > splitMessage.contentText.length
  ) {
    return {
      error: "Selected branch point no longer matches the source message."
    } as const;
  }

  const selectedBlockText = splitMessage.contentText
    .slice(splitBlockStartOffset, splitBlockEndOffset)
    .replace(/\s+/g, " ")
    .trim();
  const comparableSelectedBlock = normalizeComparableBlockText(selectedBlockText);
  const comparableFocusText = normalizeComparableBlockText(normalizedFocusText);

  if (
    !selectedBlockText ||
    (comparableFocusText &&
      !comparableSelectedBlock.includes(comparableFocusText.slice(0, 80)))
  ) {
    return {
      error: "Selected branch block no longer matches the source message."
    } as const;
  }

  const inheritedHistory = await db.query.messages.findMany({
    where: and(
      eq(messages.pathId, sourcePathId),
      lt(messages.sequenceNo, splitMessage.sequenceNo)
    ),
    orderBy: [asc(messages.sequenceNo), asc(messages.createdAt)]
  });
  const partialSplitMessage = buildPartialSplitMessage(
    splitMessage,
    splitBlockEndOffset
  );
  const snapshotHistory = [...inheritedHistory, partialSplitMessage];

  const snapshotText = formatSnapshotText({
    history: snapshotHistory,
    sourcePathTitle: sourcePath.title,
    splitBlockType,
    splitFocusText: normalizedFocusText,
    splitSequenceNo: splitMessage.sequenceNo
  });

  const branchTitle =
    title?.trim() ||
    createDefaultBranchTitle({
      parentTitle: sourcePath.title,
      splitSequenceNo: splitMessage.sequenceNo
    });

  return db.transaction(async (tx) => {
    const [branchPath] = await tx
      .insert(paths)
      .values({
        conversationId: sourcePath.conversationId,
        depth: sourcePath.depth + 1,
        isMain: false,
        parentPathId: sourcePath.id,
        pathType,
        rootPathId: sourcePath.rootPathId ?? sourcePath.id,
        splitBlockEndOffset,
        splitBlockStartOffset,
        splitBlockType,
        splitFocusText: normalizedFocusText,
        splitFromMessageId,
        title: branchTitle
      })
      .returning();

    const [snapshot] = await tx
      .insert(pathSnapshots)
      .values({
        pathId: branchPath.id,
        snapshotJson: {
          inheritedMessageCount: snapshotHistory.length,
          splitBlockEndOffset,
          splitBlockStartOffset,
          splitBlockType,
          splitFocusText: normalizedFocusText,
          splitSequenceNo: splitMessage.sequenceNo
        },
        snapshotText,
        sourceMessageId: splitFromMessageId,
        sourcePathId
      })
      .returning();

    await tx
      .update(conversations)
      .set({
        updatedAt: new Date()
      })
      .where(eq(conversations.id, sourcePath.conversationId));

    return {
      path: {
        ...branchPath,
        splitMessageCreatedAt: splitMessage.createdAt.toISOString(),
        splitMessagePreview: buildMessagePreview(partialSplitMessage.contentText),
        splitMessageSequenceNo: splitMessage.sequenceNo
      },
      snapshot
    };
  });
};
