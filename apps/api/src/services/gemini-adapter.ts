import { GoogleGenAI, type GenerateContentConfig } from "@google/genai";

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
If you cite internal context inline, use only labels visible in the provided context, such as [Retrieved context 1] or [Merge memory 1].
Do not invent citation labels.
`.trim();

const MERGE_SYSTEM_INSTRUCTION = `
You create merge artifacts for a node-based chat workspace.
Your job is to turn a branch into memory that can be attached to the main path.
Preserve important decisions, useful conclusions, and unresolved questions.
Do not copy long transcripts unless the merge mode explicitly asks for fuller detail.
Write the result so the main path can reuse it as future memory.
`.trim();

const COMPACTION_SYSTEM_INSTRUCTION = `
You create durable path memory for a node-based chat workspace.
Compress older messages from one active path into concise memory for future turns on that same path.
Preserve user goals, preferences, decisions, constraints, implemented changes, unresolved questions, and important facts.
Do not introduce knowledge from parent paths, sibling branches, or other conversations.
Do not include filler, greetings, or long transcript copies.
Write structured memory that can be safely prepended to future model context.
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

export class GeminiProviderError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "GeminiProviderError";
    this.status = status;
  }
}

const resolveGeminiModelName = (
  requestedModelName?: string | null,
  fallbackModelName = env.GEMINI_DEFAULT_MODEL
) => {
  const requested = requestedModelName?.trim();

  if (!requested) {
    return fallbackModelName;
  }

  const allowedModels = new Set(env.GEMINI_AVAILABLE_MODELS);

  if (!allowedModels.has(requested)) {
    throw new GeminiProviderError(
      400,
      `The selected hosted model "${requested}" is not listed in GEMINI_AVAILABLE_MODELS.`
    );
  }

  return requested;
};

export const supportsGeminiThinking = (modelName: string) => {
  const normalized = modelName.trim().toLowerCase().replace(/^models\//u, "");

  return (
    normalized === "gemini-2.5-flash" ||
    normalized.startsWith("gemini-2.5-flash-") ||
    normalized === "gemini-2.5-flash-lite" ||
    normalized.startsWith("gemini-2.5-flash-lite-")
  );
};

const createThinkingConfig = (
  modelName: string,
  thinkingEnabled?: boolean
): GenerateContentConfig => {
  if (!supportsGeminiThinking(modelName)) {
    return {};
  }

  return {
    thinkingConfig: {
      thinkingBudget: thinkingEnabled ? -1 : 0
    }
  };
};

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
  memoryContextText?: string | null;
  modelName?: string | null;
  thinkingEnabled?: boolean;
  webSearchEnabled?: boolean;
};

type UsageMetadata = {
  cachedTokens: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

type GroundingMetadata = Record<string, unknown>;

type GenerateMergeArtifactInput = {
  mergeMode: "light" | "full" | "reference" | "collapse";
  modelName?: string | null;
  thinkingEnabled?: boolean;
  sourcePathTitle: string;
  targetPathTitle: string;
  inheritedSnapshotText?: string | null;
  sourceMessages: Message[];
  targetMessages?: Message[];
};

type GenerateConversationTitleInput = {
  messages: Message[];
  modelName?: string | null;
  thinkingEnabled?: boolean;
};

type GeneratePathCompactionInput = {
  modelName?: string | null;
  pathTitle: string;
  previousCompactionText?: string | null;
  sourceMessages: Message[];
  thinkingEnabled?: boolean;
};

const buildPathMemoryContextText = (memoryContextText: string) =>
  [
    "Active path compacted memory:",
    "",
    memoryContextText.trim(),
    "",
    "This compacted memory belongs only to the active path. Do not treat it as parent-path or sibling-branch memory."
  ].join("\n");

const withSnapshotContext = ({
  history,
  inheritedSnapshotText,
  memoryContextText
}: GeneratePathReplyInput) => {
  const contextContents = [];

  if (inheritedSnapshotText?.trim()) {
    contextContents.push({
      role: "user" as const,
      parts: [
        {
          text: buildSplitSnapshotContextText(inheritedSnapshotText)
        }
      ]
    });
  }

  if (memoryContextText?.trim()) {
    contextContents.push({
      role: "user" as const,
      parts: [
        {
          text: buildPathMemoryContextText(memoryContextText)
        }
      ]
    });
  }

  return [
    ...contextContents,
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

const extractGroundingMetadata = (value: unknown): GroundingMetadata | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidates =
    "candidates" in value && Array.isArray(value.candidates) ? value.candidates : [];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }

    const groundingMetadata =
      "groundingMetadata" in candidate &&
      candidate.groundingMetadata &&
      typeof candidate.groundingMetadata === "object"
        ? candidate.groundingMetadata
        : null;

    if (groundingMetadata) {
      return groundingMetadata as GroundingMetadata;
    }
  }

  return null;
};

const withGoogleSearchTool = (
  config: GenerateContentConfig,
  webSearchEnabled?: boolean
): GenerateContentConfig => {
  if (!webSearchEnabled) {
    return config;
  }

  return {
    ...config,
    tools: [
      ...(config.tools ?? []),
      {
        googleSearch: {}
      }
    ]
  };
};

const buildPathGenerationRequest = async ({
  ai,
  history,
  inheritedSnapshotText,
  memoryContextText,
  modelName,
  thinkingEnabled,
  webSearchEnabled
}: GeneratePathReplyInput & { ai: GoogleGenAI }) => {
  const normalizedSnapshot = inheritedSnapshotText?.trim() ?? "";
  const normalizedMemory = memoryContextText?.trim() ?? "";
  const resolvedModelName = resolveGeminiModelName(modelName);

  if (!normalizedSnapshot) {
    return {
      cacheMode: "implicit" as const,
      cacheRecordId: null as string | null,
      cachedTokensHint: null as number | null,
      contents: withSnapshotContext({
        history,
        memoryContextText: normalizedMemory
      }),
      config: withGoogleSearchTool(
        {
          ...createThinkingConfig(resolvedModelName, thinkingEnabled),
          systemInstruction: SYSTEM_INSTRUCTION
        },
        webSearchEnabled
      )
    };
  }

  const latestMessage = history.at(-1);
  const cachePlan = await resolveSplitSnapshotCache({
    ai,
    conversationId: latestMessage?.conversationId ?? null,
    modelName: resolvedModelName,
    pathId: latestMessage?.pathId ?? null,
    snapshotText: normalizedSnapshot,
    systemInstruction: SYSTEM_INSTRUCTION
  });

  if (cachePlan.mode === "explicit") {
    return {
      cacheMode: "explicit" as const,
      cacheRecordId: cachePlan.cacheRecordId,
      cachedTokensHint: cachePlan.tokenEstimate,
      contents: withSnapshotContext({
        history,
        memoryContextText: normalizedMemory
      }),
      config: withGoogleSearchTool(
        {
          ...createThinkingConfig(resolvedModelName, thinkingEnabled),
          cachedContent: cachePlan.cachedContentName
        },
        webSearchEnabled
      )
    };
  }

  return {
    cacheMode: "implicit" as const,
    cacheRecordId: null as string | null,
    cachedTokensHint: null as number | null,
    contents: withSnapshotContext({
      history,
      inheritedSnapshotText: normalizedSnapshot,
      memoryContextText: normalizedMemory
    }),
      config: withGoogleSearchTool(
        {
          ...createThinkingConfig(resolvedModelName, thinkingEnabled),
          systemInstruction: SYSTEM_INSTRUCTION
        },
        webSearchEnabled
      )
  };
};

export const generatePathReply = async ({
  history,
  inheritedSnapshotText,
  memoryContextText,
  modelName,
  thinkingEnabled,
  webSearchEnabled
}: GeneratePathReplyInput) => {
  const ai = getClient();
  const resolvedModelName = resolveGeminiModelName(modelName);
  const request = await buildPathGenerationRequest({
    ai,
    history,
    inheritedSnapshotText,
    memoryContextText,
    modelName: resolvedModelName,
    thinkingEnabled,
    webSearchEnabled
  });

  const response = await withRetry(() =>
    ai.models.generateContent({
      model: resolvedModelName,
      contents: request.contents,
      config: request.config
    })
  );

  return {
    cacheMode: request.cacheMode,
    cacheRecordId: request.cacheRecordId,
    cachedTokensHint: request.cachedTokensHint,
    groundingMetadata: extractGroundingMetadata(response),
    modelName: resolvedModelName,
    text: response.text?.trim() ?? "",
    usage: extractUsageMetadata(response)
  };
};

export const streamPathReply = async ({
  history,
  inheritedSnapshotText,
  memoryContextText,
  modelName,
  thinkingEnabled,
  webSearchEnabled
}: GeneratePathReplyInput) => {
  const ai = getClient();
  const resolvedModelName = resolveGeminiModelName(modelName);
  const request = await buildPathGenerationRequest({
    ai,
    history,
    inheritedSnapshotText,
    memoryContextText,
    modelName: resolvedModelName,
    thinkingEnabled,
    webSearchEnabled
  });

  const rawStream = await withRetry(() =>
    ai.models.generateContentStream({
      model: resolvedModelName,
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
  const groundingMetadata: { current: GroundingMetadata | null } = {
    current: null
  };

  const stream = (async function* () {
    for await (const chunk of rawStream) {
      const extracted = extractUsageMetadata(chunk);
      const extractedGroundingMetadata = extractGroundingMetadata(chunk);

      if (extractedGroundingMetadata) {
        groundingMetadata.current = extractedGroundingMetadata;
      }

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
    groundingMetadata,
    modelName: resolvedModelName,
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

const buildCompactionPrompt = ({
  pathTitle,
  previousCompactionText,
  sourceMessages
}: GeneratePathCompactionInput) => {
  const transcript = sourceMessages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map(
      (message) =>
        `${message.role.toUpperCase()} #${message.sequenceNo} [${message.createdAt.toISOString()}]: ${message.contentText}`
    )
    .join("\n\n");

  return [
    `Path title: ${pathTitle}`,
    previousCompactionText?.trim()
      ? `Existing compacted memory to update:\n${previousCompactionText.trim()}`
      : "Existing compacted memory to update: none",
    "New source messages to fold into the path memory:",
    transcript || "(No source messages)",
    "",
    "Return only the updated compacted memory. Use short markdown sections:",
    "- Stable context",
    "- User preferences and constraints",
    "- Decisions and completed work",
    "- Current open questions or next steps",
    "",
    "Keep it compact but specific. Preserve details that future turns on this same path need."
  ].join("\n\n");
};

export const generatePathCompaction = async ({
  modelName,
  pathTitle,
  previousCompactionText,
  sourceMessages,
  thinkingEnabled
}: GeneratePathCompactionInput) => {
  const ai = getClient();
  const resolvedModelName = resolveGeminiModelName(modelName, env.GEMINI_MERGE_MODEL);

  const response = await withRetry(() =>
    ai.models.generateContent({
      model: resolvedModelName,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: buildCompactionPrompt({
                pathTitle,
                previousCompactionText,
                sourceMessages
              })
            }
          ]
        }
      ],
      config: {
        ...createThinkingConfig(resolvedModelName, thinkingEnabled),
        systemInstruction: COMPACTION_SYSTEM_INSTRUCTION
      }
    })
  );

  return {
    modelName: resolvedModelName,
    text: response.text?.trim() ?? "",
    usage: extractUsageMetadata(response)
  };
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
  modelName,
  sourcePathTitle,
  targetPathTitle,
  inheritedSnapshotText,
  sourceMessages,
  targetMessages = [],
  thinkingEnabled
}: GenerateMergeArtifactInput) => {
  const ai = getClient();
  const resolvedModelName = resolveGeminiModelName(modelName, env.GEMINI_MERGE_MODEL);

  const response = await withRetry(() =>
    ai.models.generateContent({
      model: resolvedModelName,
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
        ...createThinkingConfig(resolvedModelName, thinkingEnabled),
        systemInstruction: MERGE_SYSTEM_INSTRUCTION
      }
    })
  );

  return {
    modelName: resolvedModelName,
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
  messages,
  modelName,
  thinkingEnabled
}: GenerateConversationTitleInput) => {
  const ai = getClient();
  const resolvedModelName = resolveGeminiModelName(modelName);

  const response = await withRetry(() =>
    ai.models.generateContent({
      model: resolvedModelName,
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
        ...createThinkingConfig(resolvedModelName, thinkingEnabled),
        systemInstruction: TITLE_SYSTEM_INSTRUCTION
      }
    })
  );

  return {
    modelName: resolvedModelName,
    text: response.text?.trim() ?? "",
    usage: extractUsageMetadata(response)
  };
};
