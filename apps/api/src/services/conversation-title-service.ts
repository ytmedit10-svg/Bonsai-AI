import { and, eq } from "drizzle-orm";

import { db } from "../db/client.js";
import { conversations, messages, paths, type Message } from "../db/schema.js";
import { generateConversationTitle } from "./ai-adapter.js";

const PLACEHOLDER_TITLES = new Set(["new chat", "untitled chat", "main chat"]);
const WEAK_USER_MESSAGE_PATTERNS = [
  /^(hi|hii|hiii|hello|hey|yo|sup|wassup|what'?s up|good morning|good afternoon|good evening)[!.?]*$/i,
  /^(can you help|help me|i need help|i have a question|quick question)[!.?]*$/i,
  /^(ok|okay|thanks|thank you|cool|nice|great)[!.?]*$/i
];

const normalizeText = (value: string) => value.replace(/\s+/g, " ").trim();

const isPlaceholderTitle = (title: string) =>
  PLACEHOLDER_TITLES.has(normalizeText(title).toLowerCase());

const isMeaningfulUserMessage = (message: Message) => {
  if (message.role !== "user") {
    return false;
  }

  const text = normalizeText(message.contentText);

  if (!text) {
    return false;
  }

  if (WEAK_USER_MESSAGE_PATTERNS.some((pattern) => pattern.test(text))) {
    return false;
  }

  const wordCount = text.split(/\s+/).filter(Boolean).length;

  return text.length >= 10 || wordCount >= 2;
};

const titleCase = (value: string) =>
  value
    .toLowerCase()
    .replace(/\b[a-z]/g, (character) => character.toUpperCase());

const sanitizeTitle = (title: string) => {
  const normalized = normalizeText(title)
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^(chat\s+)?title\s*:\s*/i, "")
    .replace(/[.!?]+$/g, "")
    .trim();

  if (!normalized) {
    return null;
  }

  return normalized.length > 48 ? `${normalized.slice(0, 45).trimEnd()}...` : normalized;
};

const fallbackTitleFromMessages = (pathMessages: Message[]) => {
  const meaningfulMessage = pathMessages.find(isMeaningfulUserMessage);

  if (!meaningfulMessage) {
    return null;
  }

  return sanitizeTitle(titleCase(meaningfulMessage.contentText));
};

type MaybeGenerateConversationTitleInput = {
  conversationId: string;
  modelName?: string | null;
  thinkingEnabled?: boolean;
  pathId: string;
  userId: string;
};

export const maybeGenerateConversationTitle = async ({
  conversationId,
  modelName,
  thinkingEnabled,
  pathId,
  userId
}: MaybeGenerateConversationTitleInput) => {
  const conversation = await db.query.conversations.findFirst({
    where: and(
      eq(conversations.id, conversationId),
      eq(conversations.userId, userId)
    )
  });

  if (!conversation || !isPlaceholderTitle(conversation.title)) {
    return null;
  }

  const pathRecord = await db.query.paths.findFirst({
    where: and(
      eq(paths.id, pathId),
      eq(paths.conversationId, conversationId),
      eq(paths.isMain, true)
    )
  });

  if (!pathRecord) {
    return null;
  }

  const pathMessages = await db.query.messages.findMany({
    where: eq(messages.pathId, pathId),
    orderBy: [messages.sequenceNo, messages.createdAt],
    limit: 8
  });

  if (!pathMessages.some(isMeaningfulUserMessage)) {
    return null;
  }

  let title = fallbackTitleFromMessages(pathMessages);

  try {
    const generated = await generateConversationTitle({
      messages: pathMessages,
      modelName,
      thinkingEnabled
    });
    title = sanitizeTitle(generated.text) ?? title;
  } catch {
    // Title generation is best-effort; chat responses should never fail because of it.
  }

  if (!title || isPlaceholderTitle(title)) {
    return null;
  }

  const [updatedConversation] = await db
    .update(conversations)
    .set({
      title,
      updatedAt: new Date()
    })
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.userId, userId)
      )
    )
    .returning();

  return updatedConversation?.title ?? null;
};
