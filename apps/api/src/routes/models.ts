import type { FastifyInstance, FastifyReply } from "fastify";

import { loadEnv } from "../config/env.js";
import { getActiveInferenceProfile } from "../services/ai-adapter.js";
import { buildApiError } from "../services/api-error.js";
import {
  listLocalGemmaModels,
  OllamaProviderError
} from "../services/ollama-adapter.js";

const env = loadEnv();

const formatHostedGemmaModelLabel = (modelName: string) => {
  const normalized = modelName.toLowerCase();

  if (normalized.includes("e2b")) {
    return "Gemma 4 E2B";
  }

  if (normalized.includes("e4b")) {
    return "Gemma 4 E4B";
  }

  if (normalized.includes("26b")) {
    return normalized.includes("a4b") ? "Gemma 4 26B A4B" : "Gemma 4 26B";
  }

  if (normalized.includes("31b")) {
    return "Gemma 4 31B";
  }

  return modelName.toLowerCase().startsWith("gemma")
    ? modelName
    : `Gemma 4 ${modelName}`;
};

const getHostedGemmaModels = () => {
  const inferenceProfile = getActiveInferenceProfile();

  if (inferenceProfile.provider !== "google") {
    return null;
  }

  return [
    ...env.GEMINI_AVAILABLE_MODELS.map((modelName) => ({
      family: "gemma4",
      id: modelName,
      label: formatHostedGemmaModelLabel(modelName),
      modifiedAt: null,
      name: modelName,
      parameterSize: null,
      quantizationLevel: null,
      size: null
    }))
  ];
};

export const registerModelRoutes = (server: FastifyInstance) => {
  const getChatModels = async (_request: unknown, reply: FastifyReply) => {
    const inferenceProfile = getActiveInferenceProfile();

    if (inferenceProfile.provider === "google") {
      const models = getHostedGemmaModels() ?? [];

      return {
        defaultModel: inferenceProfile.chatModel,
        enabled: models.length > 0,
        models,
        provider: inferenceProfile.provider,
        selectedModel:
          models.find((model) => model.name === inferenceProfile.chatModel)?.name ??
          models[0]?.name ??
          null,
        supportsThinking: false
      };
    }

    if (inferenceProfile.provider !== "ollama") {
      return {
        defaultModel: null,
        enabled: false,
        models: [],
        provider: inferenceProfile.provider,
        selectedModel: null,
        supportsThinking: false
      };
    }

    try {
      const models = await listLocalGemmaModels();
      const selectedModel =
        models.find((model) => model.name === inferenceProfile.chatModel)?.name ??
        models[0]?.name ??
        null;

      return {
        defaultModel: inferenceProfile.chatModel,
        enabled: true,
        models,
        provider: "ollama",
        selectedModel,
        supportsThinking: true
      };
    } catch (error) {
      if (error instanceof OllamaProviderError) {
        return reply.code(error.status).send(
          buildApiError({
            code: `OLLAMA_MODELS_${error.status}`,
            message: error.message,
            retryable: error.status >= 500,
            type: "provider"
          })
        );
      }

      throw error;
    }
  };

  server.get("/models/chat", getChatModels);
  server.get("/models/local", getChatModels);
};
