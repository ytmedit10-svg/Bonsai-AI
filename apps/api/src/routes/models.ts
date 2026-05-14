import type { FastifyInstance, FastifyReply } from "fastify";

import { loadEnv } from "../config/env.js";
import { getActiveInferenceProfile } from "../services/ai-adapter.js";
import { buildProviderApiError } from "../services/api-error.js";
import {
  getGeminiThinkingConfigMode,
  supportsGeminiThinking
} from "../services/gemini-adapter.js";
import {
  listLocalGemmaModels,
  OllamaProviderError
} from "../services/ollama-adapter.js";

const env = loadEnv();

const titleCaseModelName = (modelName: string) =>
  modelName
    .replace(/^models\//u, "")
    .split("-")
    .filter(Boolean)
    .map((part) => {
      if (/^\d+(?:\.\d+)?$/u.test(part)) {
        return part;
      }

      return part.toUpperCase() === part
        ? part
        : `${part.charAt(0).toUpperCase()}${part.slice(1)}`;
    })
    .join(" ");

const formatHostedModelLabel = (modelName: string) => {
  const normalized = modelName.toLowerCase();

  if (normalized === "gemma-4-26b-a4b-it") {
    return "Gemma 4 26B A4B";
  }

  if (normalized === "gemma-4-31b-it") {
    return "Gemma 4 31B";
  }

  return titleCaseModelName(modelName);
};

const getHostedModelFamily = (modelName: string) =>
  modelName.toLowerCase().startsWith("gemma-4") ? "gemma4" : "hosted";

const getHostedModels = () => {
  const inferenceProfile = getActiveInferenceProfile();

  if (inferenceProfile.provider !== "google") {
    return null;
  }

  return [
    ...env.GEMINI_AVAILABLE_MODELS.map((modelName) => ({
      family: getHostedModelFamily(modelName),
      id: modelName,
      label: formatHostedModelLabel(modelName),
      modifiedAt: null,
      name: modelName,
      parameterSize: null,
      provider: "google",
      quantizationLevel: null,
      size: null,
      supportsThinking: supportsGeminiThinking(modelName),
      thinkingConfigMode: getGeminiThinkingConfigMode(modelName)
    }))
  ];
};

export const registerModelRoutes = (server: FastifyInstance) => {
  const getChatModels = async (_request: unknown, reply: FastifyReply) => {
    const inferenceProfile = getActiveInferenceProfile();

    if (inferenceProfile.provider === "google") {
      const models = getHostedModels() ?? [];

      return {
        defaultModel: inferenceProfile.chatModel,
        enabled: models.length > 0,
        models,
        provider: inferenceProfile.provider,
        selectedModel:
          models.find((model) => model.name === inferenceProfile.chatModel)?.name ??
          models[0]?.name ??
          null,
        supportsThinking: models.some((model) => model.supportsThinking)
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
          buildProviderApiError(error, "Could not load local Gemma 4 models.")
        );
      }

      throw error;
    }
  };

  server.get("/models/chat", getChatModels);
  server.get("/models/local", getChatModels);
};
