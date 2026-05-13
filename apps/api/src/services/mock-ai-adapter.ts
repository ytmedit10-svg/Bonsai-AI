import type { Message } from "../db/schema.js";

type GeneratePathReplyInput = {
  history: Message[];
  inheritedSnapshotText?: string | null;
  memoryContextText?: string | null;
  webSearchEnabled?: boolean;
};

type GenerateMergeArtifactInput = {
  mergeMode: "light" | "full" | "reference" | "collapse";
  sourcePathTitle: string;
  targetPathTitle: string;
  inheritedSnapshotText?: string | null;
  sourceMessages: Message[];
  targetMessages?: Message[];
};

type GenerateConversationTitleInput = {
  messages: Message[];
};

type GeneratePathCompactionInput = {
  pathTitle: string;
  previousCompactionText?: string | null;
  sourceMessages: Message[];
};

const MOCK_MODEL_NAME = "gemma-4-26b-a4b-it";

const usageForText = (text: string) => ({
  cachedTokens: 0,
  inputTokens: 64,
  outputTokens: Math.max(1, Math.ceil(text.length / 4)),
  totalTokens: 64 + Math.max(1, Math.ceil(text.length / 4))
});

const getLastUserText = (messages: Message[]) =>
  [...messages].reverse().find((message) => message.role === "user")?.contentText ??
  "No user prompt provided.";

const buildMockReply = ({
  history,
  inheritedSnapshotText,
  memoryContextText
}: GeneratePathReplyInput) => {
  const lastUserText = getLastUserText(history);

  return [
    "Mock Gemma replay response.",
    "",
    "Replay branch point: preserve context bundle metadata.",
    "",
    `Last user prompt: ${lastUserText}`,
    `Recent messages seen: ${history.length}`,
    `Inherited snapshot: ${inheritedSnapshotText ? "yes" : "no"}`,
    `Memory context: ${memoryContextText ? "yes" : "no"}`
  ].join("\n");
};

async function* streamText(text: string) {
  const chunks = text.match(/.{1,48}(\s|$)/g) ?? [text];

  for (const chunk of chunks) {
    yield {
      text: chunk
    };
  }
}

export const generatePathReply = async (input: GeneratePathReplyInput) => {
  const text = buildMockReply(input);

  return {
    cacheMode: "none" as const,
    cacheRecordId: null,
    groundingMetadata: null,
    modelName: MOCK_MODEL_NAME,
    text,
    usage: usageForText(text)
  };
};

export const streamPathReply = async (input: GeneratePathReplyInput) => {
  const text = buildMockReply(input);

  return {
    cacheMode: "none" as const,
    cacheRecordId: null,
    groundingMetadata: {
      current: null
    },
    modelName: MOCK_MODEL_NAME,
    stream: streamText(text),
    usage: usageForText(text)
  };
};

export const generateMergeArtifact = async ({
  mergeMode,
  sourcePathTitle,
  sourceMessages,
  targetPathTitle,
  targetMessages = []
}: GenerateMergeArtifactInput) => {
  const text = [
    `Mock ${mergeMode} merge from "${sourcePathTitle}" into "${targetPathTitle}".`,
    `Source messages: ${sourceMessages.length}.`,
    `Target messages: ${targetMessages.length}.`,
    "Merged takeaway: branch context remained replayable."
  ].join("\n");

  return {
    modelName: MOCK_MODEL_NAME,
    text,
    usage: usageForText(text)
  };
};

export const generatePathCompaction = async ({
  pathTitle,
  previousCompactionText,
  sourceMessages
}: GeneratePathCompactionInput) => {
  const text = [
    `Mock compaction for "${pathTitle}".`,
    previousCompactionText ? `Previous compaction: ${previousCompactionText}` : null,
    `Covered messages: ${sourceMessages.map((message) => message.sequenceNo).join(", ")}.`,
    `Summary: ${sourceMessages.map((message) => `${message.role}: ${message.contentText}`).join(" | ")}`
  ]
    .filter(Boolean)
    .join("\n");

  return {
    modelName: MOCK_MODEL_NAME,
    text,
    usage: usageForText(text)
  };
};

export const generateConversationTitle = async ({
  messages
}: GenerateConversationTitleInput) => {
  const firstUserText = messages.find((message) => message.role === "user")
    ?.contentText;
  const text = firstUserText
    ? `Replay: ${firstUserText.slice(0, 40)}`
    : "Replay Conversation";

  return {
    modelName: MOCK_MODEL_NAME,
    text,
    usage: usageForText(text)
  };
};
