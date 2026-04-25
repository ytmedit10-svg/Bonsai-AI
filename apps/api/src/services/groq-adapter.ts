import { loadEnv } from "../config/env.js";
import type { Message } from "../db/schema.js";

const env = loadEnv();

const GROQ_CHAT_COMPLETIONS_URL = "https://api.groq.com/openai/v1/chat/completions";
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const MAX_GENERATION_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 900;

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

type GroqRole = "assistant" | "system" | "user";

type GroqMessage = {
  content: string;
  role: GroqRole;
};

type GeneratePathReplyInput = {
  history: Message[];
  inheritedSnapshotText?: string | null;
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

type GroqChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  usage?: {
    completion_tokens?: number;
    prompt_tokens?: number;
    total_tokens?: number;
  };
};

type GroqStreamResponse = {
  choices?: Array<{
    delta?: {
      content?: string | null;
    };
  }>;
};

export class MissingGroqApiKeyError extends Error {
  constructor() {
    super("GROQ_API_KEY is missing. Add it to the root .env file before using Groq generation.");
    this.name = "MissingGroqApiKeyError";
  }
}

export class GroqProviderError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "GroqProviderError";
    this.status = status;
  }
}

const delay = async (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const parseProviderMessage = (rawText: string) => {
  try {
    const parsed = JSON.parse(rawText) as {
      error?: {
        message?: string;
      };
    };

    return parsed.error?.message ?? rawText;
  } catch {
    return rawText;
  }
};

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
        !(error instanceof GroqProviderError) ||
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

const getApiKey = () => {
  if (!env.GROQ_API_KEY) {
    throw new MissingGroqApiKeyError();
  }

  return env.GROQ_API_KEY;
};

const toGroqMessages = ({
  history,
  inheritedSnapshotText,
  systemInstruction
}: GeneratePathReplyInput & {
  systemInstruction: string;
}) => {
  const messages: GroqMessage[] = [
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

const createChatCompletion = async ({
  messages,
  model,
  stream
}: {
  messages: GroqMessage[];
  model: string;
  stream: boolean;
}) => {
  const response = await fetch(GROQ_CHAT_COMPLETIONS_URL, {
    body: JSON.stringify({
      messages,
      model,
      stream,
      temperature: 0.7
    }),
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json"
    },
    method: "POST"
  });

  if (!response.ok) {
    const rawText = await response.text();
    throw new GroqProviderError(response.status, parseProviderMessage(rawText));
  }

  return response;
};

export const generatePathReply = async ({
  history,
  inheritedSnapshotText
}: GeneratePathReplyInput) => {
  const response = await withRetry(() =>
    createChatCompletion({
      messages: toGroqMessages({
        history,
        inheritedSnapshotText,
        systemInstruction: SYSTEM_INSTRUCTION
      }),
      model: env.GROQ_DEFAULT_MODEL,
      stream: false
    })
  );

  const result = (await response.json()) as GroqChatCompletionResponse;

  return {
    cacheMode: "none" as const,
    cacheRecordId: null,
    modelName: env.GROQ_DEFAULT_MODEL,
    text: result.choices?.[0]?.message?.content?.trim() ?? "",
    usage: {
      cachedTokens: null,
      inputTokens: result.usage?.prompt_tokens ?? null,
      outputTokens: result.usage?.completion_tokens ?? null,
      totalTokens: result.usage?.total_tokens ?? null
    }
  };
};

async function* parseGroqStream(response: Response) {
  if (!response.body) {
    throw new GroqProviderError(502, "Groq returned an empty streaming response.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();

    buffer += decoder.decode(value, {
      stream: !done
    });

    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() ?? "";

    if (done && buffer.trim()) {
      events.push(buffer);
      buffer = "";
    }

    for (const event of events) {
      const lines = event.split(/\r?\n/);

      for (const line of lines) {
        const trimmed = line.trim();

        if (!trimmed.startsWith("data:")) {
          continue;
        }

        const data = trimmed.slice("data:".length).trim();

        if (!data || data === "[DONE]") {
          return;
        }

        const parsed = JSON.parse(data) as GroqStreamResponse;
        const text = parsed.choices?.[0]?.delta?.content ?? "";

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
  inheritedSnapshotText
}: GeneratePathReplyInput) => {
  const response = await withRetry(() =>
    createChatCompletion({
      messages: toGroqMessages({
        history,
        inheritedSnapshotText,
        systemInstruction: SYSTEM_INSTRUCTION
      }),
      model: env.GROQ_DEFAULT_MODEL,
      stream: true
    })
  );

  return {
    cacheMode: "none" as const,
    cacheRecordId: null,
    modelName: env.GROQ_DEFAULT_MODEL,
    stream: parseGroqStream(response),
    usage: {
      cachedTokens: null,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null
    }
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
      model: env.GROQ_MERGE_MODEL,
      stream: false
    })
  );

  const result = (await response.json()) as GroqChatCompletionResponse;

  return {
    modelName: env.GROQ_MERGE_MODEL,
    text: result.choices?.[0]?.message?.content?.trim() ?? "",
    usage: {
      cachedTokens: null,
      inputTokens: result.usage?.prompt_tokens ?? null,
      outputTokens: result.usage?.completion_tokens ?? null,
      totalTokens: result.usage?.total_tokens ?? null
    }
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
      model: env.GROQ_DEFAULT_MODEL,
      stream: false
    })
  );

  const result = (await response.json()) as GroqChatCompletionResponse;

  return {
    modelName: env.GROQ_DEFAULT_MODEL,
    text: result.choices?.[0]?.message?.content?.trim() ?? "",
    usage: {
      cachedTokens: null,
      inputTokens: result.usage?.prompt_tokens ?? null,
      outputTokens: result.usage?.completion_tokens ?? null,
      totalTokens: result.usage?.total_tokens ?? null
    }
  };
};
