import { loadEnv } from "../config/env.js";
import type { Message } from "../db/schema.js";
import {
  MissingGeminiApiKeyError,
  generateMergeArtifact as generateGeminiMergeArtifact,
  generatePathCompaction as generateGeminiPathCompaction,
  generateConversationTitle as generateGeminiConversationTitle,
  generatePathReply as generateGeminiPathReply,
  streamPathReply as streamGeminiPathReply
} from "./gemini-adapter.js";
import {
  generateMergeArtifact as generateMockMergeArtifact,
  generatePathCompaction as generateMockPathCompaction,
  generateConversationTitle as generateMockConversationTitle,
  generatePathReply as generateMockPathReply,
  streamPathReply as streamMockPathReply
} from "./mock-ai-adapter.js";
import {
  generateMergeArtifact as generateOllamaMergeArtifact,
  generatePathCompaction as generateOllamaPathCompaction,
  generateConversationTitle as generateOllamaConversationTitle,
  generatePathReply as generateOllamaPathReply,
  streamPathReply as streamOllamaPathReply
} from "./ollama-adapter.js";

const env = loadEnv();

type ModelProvider = "google" | "mock" | "ollama";

type UsageMetadata = {
  cachedTokens?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
};

type GeneratePathReplyInput = {
  history: Message[];
  inheritedSnapshotText?: string | null;
  memoryContextText?: string | null;
  modelName?: string | null;
  thinkingEnabled?: boolean;
  webSearchEnabled?: boolean;
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

export class MissingAiProviderApiKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingAiProviderApiKeyError";
  }
}

export class AiProviderCapabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiProviderCapabilityError";
  }
}

export const getActiveInferenceProfile = () => {
  const provider = resolveProvider();

  return getInferenceProfile(provider);
};

const getInferenceProfile = (provider: ModelProvider) => {
  if (provider === "mock") {
    return {
      provider,
      chatModel: env.GEMINI_DEFAULT_MODEL,
      mergeModel: env.GEMINI_MERGE_MODEL
    };
  }

  if (provider === "ollama") {
    return {
      provider,
      chatModel: env.OLLAMA_MODEL,
      mergeModel: env.OLLAMA_MERGE_MODEL
    };
  }

  return {
    provider,
    chatModel: env.GEMINI_DEFAULT_MODEL,
    mergeModel: env.GEMINI_MERGE_MODEL
  };
};

const resolveProvider = (): ModelProvider => {
  if (env.AI_PROVIDER === "mock") {
    return "mock";
  }

  if (env.AI_PROVIDER === "ollama") {
    return "ollama";
  }

  return "google";
};

const normalizeMissingKeyError = (error: unknown): never => {
  if (error instanceof MissingGeminiApiKeyError) {
    throw new MissingAiProviderApiKeyError(error.message);
  }

  throw error;
};

export const generatePathReply = async (input: GeneratePathReplyInput) => {
  const provider = resolveProvider();

  try {
    if (provider === "mock") {
      const result = await generateMockPathReply(input);

      return {
        ...result,
        usage: result.usage as UsageMetadata | undefined,
        modelProvider: provider
      };
    }

    if (provider === "ollama") {
      if (input.webSearchEnabled) {
        throw new AiProviderCapabilityError(
          "Web search requires the Gemini provider with Google Search grounding."
        );
      }

      const result = await generateOllamaPathReply(input);

      return {
        ...result,
        groundingMetadata: null,
        usage: result.usage as UsageMetadata | undefined,
        modelProvider: provider
      };
    }

    const result = await generateGeminiPathReply(input);

    return {
      ...result,
      usage: result.usage as UsageMetadata | undefined,
      modelProvider: provider
    };
  } catch (error) {
    return normalizeMissingKeyError(error);
  }
};

export const streamPathReply = async (input: GeneratePathReplyInput) => {
  const provider = resolveProvider();

  try {
    if (provider === "mock") {
      const result = await streamMockPathReply(input);

      return {
        ...result,
        usage: result.usage as UsageMetadata | undefined,
        modelProvider: provider
      };
    }

    if (provider === "ollama") {
      if (input.webSearchEnabled) {
        throw new AiProviderCapabilityError(
          "Web search requires the Gemini provider with Google Search grounding."
        );
      }

      const result = await streamOllamaPathReply(input);

      return {
        ...result,
        groundingMetadata: {
          current: null
        },
        usage: result.usage as UsageMetadata | undefined,
        modelProvider: provider
      };
    }

    const result = await streamGeminiPathReply(input);

    return {
      ...result,
      usage: result.usage as UsageMetadata | undefined,
      modelProvider: provider
    };
  } catch (error) {
    return normalizeMissingKeyError(error);
  }
};

export const generateMergeArtifact = async (input: GenerateMergeArtifactInput) => {
  const provider = resolveProvider();

  try {
    if (provider === "mock") {
      const result = await generateMockMergeArtifact(input);

      return {
        ...result,
        usage: result.usage as UsageMetadata | undefined,
        modelProvider: provider
      };
    }

    if (provider === "ollama") {
      const result = await generateOllamaMergeArtifact(input);

      return {
        ...result,
        usage: result.usage as UsageMetadata | undefined,
        modelProvider: provider
      };
    }

    const result = await generateGeminiMergeArtifact(input);

    return {
      ...result,
      usage: result.usage as UsageMetadata | undefined,
      modelProvider: provider
    };
  } catch (error) {
    return normalizeMissingKeyError(error);
  }
};

export const generatePathCompaction = async (input: GeneratePathCompactionInput) => {
  const provider = resolveProvider();

  try {
    if (provider === "mock") {
      const result = await generateMockPathCompaction(input);

      return {
        ...result,
        usage: result.usage as UsageMetadata | undefined,
        modelProvider: provider
      };
    }

    if (provider === "ollama") {
      const result = await generateOllamaPathCompaction(input);

      return {
        ...result,
        usage: result.usage as UsageMetadata | undefined,
        modelProvider: provider
      };
    }

    const result = await generateGeminiPathCompaction(input);

    return {
      ...result,
      usage: result.usage as UsageMetadata | undefined,
      modelProvider: provider
    };
  } catch (error) {
    return normalizeMissingKeyError(error);
  }
};

export const generateConversationTitle = async (input: GenerateConversationTitleInput) => {
  const provider = resolveProvider();

  try {
    if (provider === "mock") {
      const result = await generateMockConversationTitle(input);

      return {
        ...result,
        usage: result.usage as UsageMetadata | undefined,
        modelProvider: provider
      };
    }

    if (provider === "ollama") {
      const result = await generateOllamaConversationTitle(input);

      return {
        ...result,
        usage: result.usage as UsageMetadata | undefined,
        modelProvider: provider
      };
    }

    const result = await generateGeminiConversationTitle(input);

    return {
      ...result,
      usage: result.usage as UsageMetadata | undefined,
      modelProvider: provider
    };
  } catch (error) {
    return normalizeMissingKeyError(error);
  }
};
