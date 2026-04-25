import { and, eq } from "drizzle-orm";

import { db } from "../db/client.js";
import { conversations, conversationViewStates, paths } from "../db/schema.js";

type UpdateConversationViewStateInput = {
  conversationId: string;
  lastActivePathId: string | null;
  userId: string;
};

const serializeViewState = (
  conversationId: string,
  viewState: typeof conversationViewStates.$inferSelect | null
) => ({
  conversationId,
  lastActivePathId: viewState?.lastActivePathId ?? null,
  updatedAt: viewState?.updatedAt?.toISOString() ?? null
});

export const getConversationViewState = async (
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

  const viewState = await db.query.conversationViewStates.findFirst({
    where: eq(conversationViewStates.conversationId, conversationId)
  });

  return serializeViewState(conversationId, viewState ?? null);
};

export const updateConversationViewState = async ({
  conversationId,
  lastActivePathId,
  userId
}: UpdateConversationViewStateInput) => {
  const conversation = await db.query.conversations.findFirst({
    where: and(
      eq(conversations.id, conversationId),
      eq(conversations.userId, userId)
    )
  });

  if (!conversation) {
    return null;
  }

  if (lastActivePathId) {
    const selectedPath = await db.query.paths.findFirst({
      where: and(
        eq(paths.id, lastActivePathId),
        eq(paths.conversationId, conversationId)
      )
    });

    if (!selectedPath) {
      return {
        error: "Path does not belong to this conversation." as const
      };
    }
  }

  const [viewState] = await db
    .insert(conversationViewStates)
    .values({
      conversationId,
      lastActivePathId
    })
    .onConflictDoUpdate({
      set: {
        lastActivePathId,
        updatedAt: new Date()
      },
      target: conversationViewStates.conversationId
    })
    .returning();

  return serializeViewState(conversationId, viewState);
};
