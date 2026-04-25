import { GoogleGenAI } from "@google/genai";

import { loadEnv } from "../config/env.js";
import type { Message } from "../db/schema.js";
import {
  buildSplitSnapshotContextText,
  resolveSplitSnapshotCache
} from "./cache-service.js";

const env = loadEnv();

const SYSTEM_INSTRUCTION = `
You are the assistant inside a node-based chat workspace.
Continue the active path faithfully.
Use the path's prior messages as its working memory.
Answer clearly, directly, and helpfully.
Do not claim knowledge from parent or sibling branches unless it appears in the provided path history.
`.trim();

const MERGE_SYSTEM_INSTRUCTION = `
You create merge artifacts for a node-based chat workspace.
Your job is to turn a branch into memory that can be attached to the main path.
Preserve important decisions, useful conclusions, and unresolved questions.
Do not copy long transcripts unless the merge mode explicitly asks for fuller detail.
Write the result so the main path can reuse it as future memory.
`.trim();

const TITLE_SYSTEM_INSTRUCTION = `
You create concise chat titles for a chat app sidebar.
Write only the title.
Use 3 to 6 words when possible.
Do not use quotation marks.
Do not title the chat from greetings, small talk, or vague setup.
Focus on the user's actual goal or topic.
`.trim();

let client: GoogleGenAI | null = null;
const RETRYABLE_STATUS_CODES = new Set([429, 500, 503]);
const MAX_GENERATION_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 900;

export class MissingGeminiApiKeyError extends Error {
  constructor() {
    super("GEMINI_API_KEY is missing. Add it to the root .env file before using Gemini generation.");
    this.name = "MissingGeminiApiKeyError";
  }
}

const getErrorStatusCode = (error: unknown) => {
  if (!error || typeof error !== "object" || !("status" in error)) {
    return null;
  }

  return typeof error.status === "number" ? error.status : null;
};

const isRetryableProviderError = (error: unknown) => {
  const statusCode = getErrorStatusCode(error);
  return statusCode !== null && RETRYABLE_STATUS_CODES.has(statusCode);
};

const delay = async (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const withRetry = async <T>(operation: () => Promise<T>) => {
  let attempt = 0;
  let lastError: unknown;

  while (attempt < MAX_GENERATION_ATTEMPTS) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      attempt += 1;

      if (!isRetryableProviderError(error) || attempt >= MAX_GENERATION_ATTEMPTS) {
        throw error;
      }

      await delay(BASE_RETRY_DELAY_MS * attempt);
    }
  }

  throw lastError;
};

const getClient = () => {
  if (!env.GEMINI_API_KEY) {
    throw new MissingGeminiApiKeyError();
  }

  client ??= new GoogleGenAI({
    apiKey: env.GEMINI_API_KEY
  });

  return client;
};

const toGeminiRole = (role: Message["role"]) => {
  if (role === "assistant") {
    return "model";
  }

  return "user";
};

const toGeminiContents = (history: Message[]) => {
  return history
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({
      role: toGeminiRole(message.role),
      parts: [
        {
          text: message.contentText
        }
      ]
    }));
};

type GeneratePathReplyInput = {
  history: Message[];
  inheritedSnapshotText?: string | null;
};

type UsageMetadata = {
  cachedTokens: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
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

const withSnapshotContext = ({
  history,
  inheritedSnapshotText
}: GeneratePathReplyInput) => {
  if (!inheritedSnapshotText?.trim()) {
    return toGeminiContents(history);
  }

  return [
    {
      role: "user" as const,
      parts: [
        {
          text: buildSplitSnapshotContextText(inheritedSnapshotText)
        }
      ]
    },
    ...toGeminiContents(history)
  ];
};

const toNumberOrNull = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const extractUsageMetadata = (value: unknown): UsageMetadata => {
  if (!value || typeof value !== "object") {
    return {
      cachedTokens: null,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null
    };
  }

  const usageMetadata =
    "usageMetadata" in value && value.usageMetadata && typeof value.usageMetadata === "object"
      ? value.usageMetadata
      : null;

  if (!usageMetadata) {
    return {
      cachedTokens: null,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null
    };
  }

  return {
    cachedTokens: toNumberOrNull(
      (usageMetadata as Record<string, unknown>).cachedContentTokenCount
    ),
    inputTokens: toNumberOrNull((usageMetadata as Record<string, unknown>).promptTokenCount),
    outputTokens: toNumberOrNull(
      (usageMetadata as Record<string, unknown>).candidatesTokenCount
    ),
    totalTokens: toNumberOrNull((usageMetadata as Record<string, unknown>).totalTokenCount)
  };
};

const buildPathGenerationRequest = async ({
  ai,
  history,
  inheritedSnapshotText
}: GeneratePathReplyInput & { ai: GoogleGenAI }) => {
  const normalizedSnapshot = inheritedSnapshotText?.trim() ?? "";

  if (!normalizedSnapshot) {
    return {
      cacheMode: "implicit" as const,
      cacheRecordId: null as string | null,
      cachedTokensHint: null as number | null,
      contents: toGeminiContents(history),
      config: {
        systemInstruction: SYSTEM_INSTRUCTION
      }
    };
  }

  const latestMessage = history.at(-1);
  const cachePlan = await resolveSplitSnapshotCache({
    ai,
    conversationId: latestMessage?.conversationId ?? null,
    modelName: env.GEMINI_DEFAULT_MODEL,
    pathId: latestMessage?.pathId ?? null,
    snapshotText: normalizedSnapshot,
    systemInstruction: SYSTEM_INSTRUCTION
  });

  if (cachePlan.mode === "explicit") {
    return {
      cacheMode: "explicit" as const,
      cacheRecordId: cachePlan.cacheRecordId,
      cachedTokensHint: cachePlan.tokenEstimate,
      contents: toGeminiContents(history),
      config: {
        cachedContent: cachePlan.cachedContentName
      }
    };
  }

  return {
    cacheMode: "implicit" as const,
    cacheRecordId: null as string | null,
    cachedTokensHint: null as number | null,
    contents: withSnapshotContext({
      history,
      inheritedSnapshotText: normalizedSnapshot
    }),
    config: {
      systemInstruction: SYSTEM_INSTRUCTION
    }
  };
};

export const generatePathReply = async ({
  history,
  inheritedSnapshotText
}: GeneratePathReplyInput) => {
  const ai = getClient();
  const request = await buildPathGenerationRequest({
    ai,
    history,
    inheritedSnapshotText
  });

  const response = await withRetry(() =>
    ai.models.generateContent({
      model: env.GEMINI_DEFAULT_MODEL,
      contents: request.contents,
      config: request.config
    })
  );

  return {
    cacheMode: request.cacheMode,
    cacheRecordId: request.cacheRecordId,
    cachedTokensHint: request.cachedTokensHint,
    modelName: env.GEMINI_DEFAULT_MODEL,
    text: response.text?.trim() ?? "",
    usage: extractUsageMetadata(response)
  };
};

export const streamPathReply = async ({
  history,
  inheritedSnapshotText
}: GeneratePathReplyInput) => {
  const ai = getClient();
  const request = await buildPathGenerationRequest({
    ai,
    history,
    inheritedSnapshotText
  });

  const rawStream = await withRetry(() =>
    ai.models.generateContentStream({
      model: env.GEMINI_DEFAULT_MODEL,
      contents: request.contents,
      config: request.config
    })
  );

  const usage: UsageMetadata = {
    cachedTokens: request.cachedTokensHint ?? null,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null
  };

  const stream = (async function* () {
    for await (const chunk of rawStream) {
      const extracted = extractUsageMetadata(chunk);

      if (extracted.inputTokens !== null) {
        usage.inputTokens = extracted.inputTokens;
      }

      if (extracted.outputTokens !== null) {
        usage.outputTokens = extracted.outputTokens;
      }

      if (extracted.totalTokens !== null) {
        usage.totalTokens = extracted.totalTokens;
      }

      if (extracted.cachedTokens !== null) {
        usage.cachedTokens = extracted.cachedTokens;
      }

      yield chunk;
    }
  })();

  return {
    cacheMode: request.cacheMode,
    cacheRecordId: request.cacheRecordId,
    modelName: env.GEMINI_DEFAULT_MODEL,
    stream,
    usage
  };
};

const formatMergeModeInstruction = (
  mergeMode: GenerateMergeArtifactInput["mergeMode"]
) => {
  switch (mergeMode) {
    case "light":
      return "Produce a compact merge memory with a short summary, key decisions, and open questions.";
    case "full":
      return "Produce a rich merge artifact with sections for summary, conclusions, decisions, evidence, and open questions.";
    case "reference":
      return "Produce a concise reference-style artifact optimized for quick recall on the main path.";
    case "collapse":
      return "Produce a collapsed artifact that reads like the main path learned the branch's most important outcomes.";
    default:
      return "Produce a useful merge artifact for the main path.";
  }
};

const formatTranscript = (label: string, history: Message[]) => {
  if (history.length === 0) {
    return `${label}\n(No messages)\n`;
  }

  return [
    label,
    ...history
      .filter((message) => message.role === "user" || message.role === "assistant")
      .map(
        (message) =>
          `${message.role.toUpperCase()} [${message.createdAt.toISOString()}]: ${message.contentText}`
      )
  ].join("\n");
};

const buildMergePrompt = ({
  mergeMode,
  sourcePathTitle,
  targetPathTitle,
  inheritedSnapshotText,
  sourceMessages,
  targetMessages = []
}: GenerateMergeArtifactInput) => {
  const sections = [
    `Merge mode: ${mergeMode}`,
    `Source branch: ${sourcePathTitle}`,
    `Target path: ${targetPathTitle}`,
    formatMergeModeInstruction(mergeMode)
  ];

  if (inheritedSnapshotText?.trim()) {
    sections.push(`Inherited branch snapshot:\n${inheritedSnapshotText}`);
  }

  sections.push(formatTranscript("Source branch transcript:", sourceMessages));

  if (targetMessages.length > 0) {
    sections.push(formatTranscript("Recent target-path context:", targetMessages));
  }

  sections.push(
    [
      "Output requirements:",
      "- Keep it grounded in the provided branch material.",
      "- Make the result useful as future memory for the target path.",
      "- Mention unresolved questions when they matter.",
      "- Avoid raw JSON and avoid transcript dumps unless necessary."
    ].join("\n")
  );

  return sections.join("\n\n");
};

export const generateMergeArtifact = async ({
  mergeMode,
  sourcePathTitle,
  targetPathTitle,
  inheritedSnapshotText,
  sourceMessages,
  targetMessages = []
}: GenerateMergeArtifactInput) => {
  const ai = getClient();

  const response = await withRetry(() =>
    ai.models.generateContent({
      model: env.GEMINI_MERGE_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: buildMergePrompt({
                mergeMode,
                sourcePathTitle,
                targetPathTitle,
                inheritedSnapshotText,
                sourceMessages,
                targetMessages
              })
            }
          ]
        }
      ],
      config: {
        systemInstruction: MERGE_SYSTEM_INSTRUCTION
      }
    })
  );

  return {
    modelName: env.GEMINI_MERGE_MODEL,
    text: response.text?.trim() ?? "",
    usage: extractUsageMetadata(response)
  };
};

const buildTitlePrompt = (messages: Message[]) => {
  const transcript = messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(0, 8)
    .map((message) => `${message.role.toUpperCase()}: ${message.contentText}`)
    .join("\n");

  return [
    "Create a sidebar title for this conversation.",
    "If the first message is just a greeting, ignore it and use the first meaningful user intent.",
    "Return only the title text.",
    "",
    transcript
  ].join("\n");
};

export const generateConversationTitle = async ({
  messages
}: GenerateConversationTitleInput) => {
  const ai = getClient();

  const response = await withRetry(() =>
    ai.models.generateContent({
      model: env.GEMINI_DEFAULT_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: buildTitlePrompt(messages)
            }
          ]
        }
      ],
      config: {
        systemInstruction: TITLE_SYSTEM_INSTRUCTION
      }
    })
  );

  return {
    modelName: env.GEMINI_DEFAULT_MODEL,
    text: response.text?.trim() ?? "",
    usage: extractUsageMetadata(response)
  };
};
