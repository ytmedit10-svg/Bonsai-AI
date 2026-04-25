import { loadEnv } from "../config/env.js";
import type { Message } from "../db/schema.js";
import {
  MissingGeminiApiKeyError,
  generateMergeArtifact as generateGeminiMergeArtifact,
  generateConversationTitle as generateGeminiConversationTitle,
  generatePathReply as generateGeminiPathReply,
  streamPathReply as streamGeminiPathReply
} from "./gemini-adapter.js";
import {
  MissingGroqApiKeyError,
  generateMergeArtifact as generateGroqMergeArtifact,
  generateConversationTitle as generateGroqConversationTitle,
  generatePathReply as generateGroqPathReply,
  streamPathReply as streamGroqPathReply
} from "./groq-adapter.js";

const env = loadEnv();

type ModelProvider = "google" | "groq";

type UsageMetadata = {
  cachedTokens?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
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

export class MissingAiProviderApiKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingAiProviderApiKeyError";
  }
}

export const getActiveInferenceProfile = () => {
  const provider = resolveProvider();

  return getInferenceProfile(provider);
};

const getInferenceProfile = (provider: ModelProvider) => {
  if (provider === "groq") {
    return {
      provider,
      chatModel: env.GROQ_DEFAULT_MODEL,
      mergeModel: env.GROQ_MERGE_MODEL
    };
  }

  return {
    provider,
    chatModel: env.GEMINI_DEFAULT_MODEL,
    mergeModel: env.GEMINI_MERGE_MODEL
  };
};

const resolveProvider = (): ModelProvider => {
  if (env.AI_PROVIDER === "groq") {
    return "groq";
  }

  if (env.AI_PROVIDER === "gemini") {
    return "google";
  }

  if (env.GEMINI_API_KEY) {
    return "google";
  }

  return env.GROQ_API_KEY ? "groq" : "google";
};

const canFallbackToGroq = (provider: ModelProvider) =>
  env.AI_PROVIDER === "auto" && provider === "google" && Boolean(env.GROQ_API_KEY);

const normalizeMissingKeyError = (error: unknown): never => {
  if (
    error instanceof MissingGeminiApiKeyError ||
    error instanceof MissingGroqApiKeyError
  ) {
    throw new MissingAiProviderApiKeyError(error.message);
  }

  throw error;
};

export const generatePathReply = async (input: GeneratePathReplyInput) => {
  const provider = resolveProvider();

  try {
    if (provider === "groq") {
      const result = await generateGroqPathReply(input);

      return {
        ...result,
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
    if (canFallbackToGroq(provider)) {
      try {
        const result = await generateGroqPathReply(input);

        return {
          ...result,
          usage: result.usage as UsageMetadata | undefined,
          modelProvider: "groq" satisfies ModelProvider
        };
      } catch (fallbackError) {
        return normalizeMissingKeyError(fallbackError);
      }
    }

    return normalizeMissingKeyError(error);
  }
};

export const streamPathReply = async (input: GeneratePathReplyInput) => {
  const provider = resolveProvider();

  try {
    if (provider === "groq") {
      const result = await streamGroqPathReply(input);

      return {
        ...result,
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
    if (canFallbackToGroq(provider)) {
      try {
        const result = await streamGroqPathReply(input);

        return {
          ...result,
          usage: result.usage as UsageMetadata | undefined,
          modelProvider: "groq" satisfies ModelProvider
        };
      } catch (fallbackError) {
        return normalizeMissingKeyError(fallbackError);
      }
    }

    return normalizeMissingKeyError(error);
  }
};

export const generateMergeArtifact = async (input: GenerateMergeArtifactInput) => {
  const provider = resolveProvider();

  try {
    if (provider === "groq") {
      const result = await generateGroqMergeArtifact(input);

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
    if (canFallbackToGroq(provider)) {
      try {
        const result = await generateGroqMergeArtifact(input);

        return {
          ...result,
          usage: result.usage as UsageMetadata | undefined,
          modelProvider: "groq" satisfies ModelProvider
        };
      } catch (fallbackError) {
        return normalizeMissingKeyError(fallbackError);
      }
    }

    return normalizeMissingKeyError(error);
  }
};

export const generateConversationTitle = async (input: GenerateConversationTitleInput) => {
  const provider = resolveProvider();

  try {
    if (provider === "groq") {
      const result = await generateGroqConversationTitle(input);

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
    if (canFallbackToGroq(provider)) {
      try {
        const result = await generateGroqConversationTitle(input);

        return {
          ...result,
          usage: result.usage as UsageMetadata | undefined,
          modelProvider: "groq" satisfies ModelProvider
        };
      } catch (fallbackError) {
        return normalizeMissingKeyError(fallbackError);
      }
    }

    return normalizeMissingKeyError(error);
  }
};
