import { loadEnv } from "../config/env.js";
import type { Message } from "../db/schema.js";

const env = loadEnv();

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const MAX_GENERATION_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 900;

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

type OllamaRole = "assistant" | "system" | "user";

type OllamaMessage = {
  content: string;
  role: OllamaRole;
};

type UsageMetadata = {
  cachedTokens: null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

type GeneratePathReplyInput = {
  history: Message[];
  inheritedSnapshotText?: string | null;
  memoryContextText?: string | null;
  modelName?: string | null;
  thinkingEnabled?: boolean;
};

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
  thinkingEnabled?: boolean;
  pathTitle: string;
  previousCompactionText?: string | null;
  sourceMessages: Message[];
};

type OllamaChatResponse = {
  done?: boolean;
  eval_count?: number;
  message?: {
    content?: string | null;
    role?: string;
    thinking?: string | null;
  };
  prompt_eval_count?: number;
};

type OllamaTagsResponse = {
  models?: Array<{
    details?: {
      family?: string;
      parameter_size?: string;
      quantization_level?: string;
    };
    model?: string;
    modified_at?: string;
    name?: string;
    size?: number;
  }>;
};

export type LocalOllamaModelOption = {
  family: string;
  id: string;
  label: string;
  modifiedAt: string | null;
  name: string;
  parameterSize: string | null;
  quantizationLevel: string | null;
  size: number | null;
};

export class OllamaProviderError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "OllamaProviderError";
    this.status = status;
  }
}

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

      if (
        !(error instanceof OllamaProviderError) ||
        !RETRYABLE_STATUS_CODES.has(error.status) ||
        attempt >= MAX_GENERATION_ATTEMPTS
      ) {
        throw error;
      }

      await delay(BASE_RETRY_DELAY_MS * attempt);
    }
  }

  throw lastError;
};

const getOllamaUrl = (path: string) =>
  `${env.OLLAMA_BASE_URL.replace(/\/+$/, "")}${path}`;

const parseProviderMessage = (rawText: string) => {
  try {
    const parsed = JSON.parse(rawText) as {
      error?: string | {
        message?: string;
      };
    };

    if (typeof parsed.error === "string") {
      return parsed.error;
    }

    return parsed.error?.message ?? rawText;
  } catch {
    return rawText;
  }
};

const createChatCompletion = async ({
  messages,
  model,
  stream,
  thinkingEnabled
}: {
  messages: OllamaMessage[];
  model: string;
  stream: boolean;
  thinkingEnabled?: boolean;
}) => {
  let response: Response;

  try {
    response = await fetch(getOllamaUrl("/api/chat"), {
      body: JSON.stringify({
        keep_alive: "10m",
        messages,
        model,
        options: {
          num_ctx: env.OLLAMA_NUM_CTX,
          temperature: 0.7
        },
        think: Boolean(thinkingEnabled),
        stream
      }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });
  } catch {
    throw new OllamaProviderError(
      503,
      `Could not reach Ollama at ${env.OLLAMA_BASE_URL}. Start Ollama and run ollama pull ${model}.`
    );
  }

  if (!response.ok) {
    const rawText = await response.text();
    throw new OllamaProviderError(response.status, parseProviderMessage(rawText));
  }

  return response;
};

const formatGemmaModelLabel = ({
  name,
  parameterSize
}: {
  name: string;
  parameterSize: string | null;
}) => {
  const normalized = name.toLowerCase();
  let sizeLabel = parameterSize ?? name.replace(/^gemma4:/i, "");

  if (normalized.includes("e2b")) {
    sizeLabel = "E2B";
  } else if (normalized.includes("e4b")) {
    sizeLabel = "E4B";
  } else if (normalized.includes("26b")) {
    sizeLabel = normalized.includes("a4b") ? "26B A4B" : "26B";
  } else if (normalized.includes("31b")) {
    sizeLabel = "31B";
  }

  return `Gemma 4 ${sizeLabel}`;
};

const isGemma4Model = (model: NonNullable<OllamaTagsResponse["models"]>[number]) => {
  const name = model.name ?? model.model ?? "";
  const family = model.details?.family ?? "";

  return family.toLowerCase() === "gemma4" || name.toLowerCase().startsWith("gemma4:");
};

export const listLocalGemmaModels = async () => {
  let response: Response;

  try {
    response = await fetch(getOllamaUrl("/api/tags"));
  } catch {
    throw new OllamaProviderError(
      503,
      `Could not reach Ollama at ${env.OLLAMA_BASE_URL}. Start Ollama before selecting local Gemma 4 models.`
    );
  }

  if (!response.ok) {
    const rawText = await response.text();
    throw new OllamaProviderError(response.status, parseProviderMessage(rawText));
  }

  const result = (await response.json()) as OllamaTagsResponse;

  return (result.models ?? [])
    .filter(isGemma4Model)
    .map((model): LocalOllamaModelOption => {
      const name = model.name ?? model.model ?? "";
      const parameterSize = model.details?.parameter_size ?? null;
      const quantizationLevel = model.details?.quantization_level ?? null;

      return {
        family: model.details?.family ?? "gemma4",
        id: name,
        label: formatGemmaModelLabel({
          name,
          parameterSize
        }),
        modifiedAt: model.modified_at ?? null,
        name,
        parameterSize,
        quantizationLevel,
        size: model.size ?? null
      };
    })
    .sort((left, right) => left.label.localeCompare(right.label));
};

const resolveOllamaModelName = async (
  requestedModelName?: string | null,
  fallbackModelName = env.OLLAMA_MODEL
) => {
  const models = await listLocalGemmaModels();
  const requested = requestedModelName?.trim();

  if (requested) {
    const requestedModel = models.find((model) => model.name === requested);

    if (!requestedModel) {
      throw new OllamaProviderError(
        400,
        `The selected local model "${requested}" is not an installed Gemma 4 Ollama model.`
      );
    }

    return requestedModel.name;
  }

  const defaultModel = models.find((model) => model.name === fallbackModelName);

  if (defaultModel) {
    return defaultModel.name;
  }

  if (models[0]) {
    return models[0].name;
  }

  throw new OllamaProviderError(
    404,
    "No local Gemma 4 Ollama models were found. Run ollama pull gemma4:e4b."
  );
};

const toOllamaMessages = ({
  history,
  inheritedSnapshotText,
  memoryContextText,
  systemInstruction
}: GeneratePathReplyInput & {
  systemInstruction: string;
}) => {
  const messages: OllamaMessage[] = [
    {
      content: systemInstruction,
      role: "system"
    }
  ];

  if (inheritedSnapshotText?.trim()) {
    messages.push({
      content: `Inherited branch memory snapshot:\n\n${inheritedSnapshotText}`,
      role: "system"
    });
  }

  if (memoryContextText?.trim()) {
    messages.push({
      content: [
        "Active path compacted memory:",
        "",
        memoryContextText.trim(),
        "",
        "This compacted memory belongs only to the active path. Do not treat it as parent-path or sibling-branch memory."
      ].join("\n"),
      role: "system"
    });
  }

  for (const message of history) {
    if (message.role !== "user" && message.role !== "assistant") {
      continue;
    }

    messages.push({
      content: message.contentText,
      role: message.role
    });
  }

  return messages;
};

const toUsage = (result: OllamaChatResponse): UsageMetadata => {
  const inputTokens = result.prompt_eval_count ?? null;
  const outputTokens = result.eval_count ?? null;

  return {
    cachedTokens: null,
    inputTokens,
    outputTokens,
    totalTokens:
      inputTokens === null && outputTokens === null
        ? null
        : (inputTokens ?? 0) + (outputTokens ?? 0)
  };
};

export const generatePathReply = async ({
  history,
  inheritedSnapshotText,
  memoryContextText,
  modelName,
  thinkingEnabled
}: GeneratePathReplyInput) => {
  const resolvedModelName = await resolveOllamaModelName(modelName);
  const response = await withRetry(() =>
    createChatCompletion({
      messages: toOllamaMessages({
        history,
        inheritedSnapshotText,
        memoryContextText,
        systemInstruction: SYSTEM_INSTRUCTION
      }),
      model: resolvedModelName,
      stream: false,
      thinkingEnabled
    })
  );

  const result = (await response.json()) as OllamaChatResponse;

  return {
    cacheMode: "none" as const,
    cacheRecordId: null,
    modelName: resolvedModelName,
    text: result.message?.content?.trim() ?? "",
    usage: toUsage(result)
  };
};

async function* parseOllamaStream(response: Response, usage: UsageMetadata) {
  if (!response.body) {
    throw new OllamaProviderError(502, "Ollama returned an empty streaming response.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();

    buffer += decoder.decode(value, {
      stream: !done
    });

    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    if (done && buffer.trim()) {
      lines.push(buffer);
      buffer = "";
    }

    for (const line of lines) {
      const trimmed = line.trim();

      if (!trimmed) {
        continue;
      }

      const parsed = JSON.parse(trimmed) as OllamaChatResponse;

      if (parsed.done) {
        const finalUsage = toUsage(parsed);
        usage.inputTokens = finalUsage.inputTokens;
        usage.outputTokens = finalUsage.outputTokens;
        usage.totalTokens = finalUsage.totalTokens;
        return;
      }

      const text = parsed.message?.content ?? "";

      if (text) {
        yield {
          text
        };
      }
    }

    if (done) {
      return;
    }
  }
}

export const streamPathReply = async ({
  history,
  inheritedSnapshotText,
  memoryContextText,
  modelName,
  thinkingEnabled
}: GeneratePathReplyInput) => {
  const resolvedModelName = await resolveOllamaModelName(modelName);
  const response = await withRetry(() =>
    createChatCompletion({
      messages: toOllamaMessages({
        history,
        inheritedSnapshotText,
        memoryContextText,
        systemInstruction: SYSTEM_INSTRUCTION
      }),
      model: resolvedModelName,
      stream: true,
      thinkingEnabled
    })
  );
  const usage: UsageMetadata = {
    cachedTokens: null,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null
  };

  return {
    cacheMode: "none" as const,
    cacheRecordId: null,
    modelName: resolvedModelName,
    stream: parseOllamaStream(response, usage),
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
  const resolvedModelName = await resolveOllamaModelName(
    modelName,
    env.OLLAMA_MERGE_MODEL
  );
  const response = await withRetry(() =>
    createChatCompletion({
      messages: [
        {
          content: COMPACTION_SYSTEM_INSTRUCTION,
          role: "system"
        },
        {
          content: buildCompactionPrompt({
            pathTitle,
            previousCompactionText,
            sourceMessages
          }),
          role: "user"
        }
      ],
      model: resolvedModelName,
      stream: false,
      thinkingEnabled
    })
  );

  const result = (await response.json()) as OllamaChatResponse;

  return {
    cacheMode: "none" as const,
    cacheRecordId: null,
    modelName: resolvedModelName,
    text: result.message?.content?.trim() ?? "",
    usage: toUsage(result)
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
  const resolvedModelName = await resolveOllamaModelName(
    modelName,
    env.OLLAMA_MERGE_MODEL
  );
  const response = await withRetry(() =>
    createChatCompletion({
      messages: [
        {
          content: MERGE_SYSTEM_INSTRUCTION,
          role: "system"
        },
        {
          content: buildMergePrompt({
            mergeMode,
            sourcePathTitle,
            targetPathTitle,
            inheritedSnapshotText,
            sourceMessages,
            targetMessages
          }),
          role: "user"
        }
      ],
      model: resolvedModelName,
      stream: false,
      thinkingEnabled
    })
  );

  const result = (await response.json()) as OllamaChatResponse;

  return {
    modelName: resolvedModelName,
    text: result.message?.content?.trim() ?? "",
    usage: toUsage(result)
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
  const resolvedModelName = await resolveOllamaModelName(modelName);
  const response = await withRetry(() =>
    createChatCompletion({
      messages: [
        {
          content: TITLE_SYSTEM_INSTRUCTION,
          role: "system"
        },
        {
          content: buildTitlePrompt(messages),
          role: "user"
        }
      ],
      model: resolvedModelName,
      stream: false,
      thinkingEnabled
    })
  );

  const result = (await response.json()) as OllamaChatResponse;

  return {
    modelName: resolvedModelName,
    text: result.message?.content?.trim() ?? "",
    usage: toUsage(result)
  };
};
