import type { FastifyInstance, FastifyReply } from "fastify";

import { loadEnv } from "../config/env.js";
import { getActiveInferenceProfile } from "../services/ai-adapter.js";
import { buildApiError } from "../services/api-error.js";
import { supportsGeminiThinking } from "../services/gemini-adapter.js";
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

  if (normalized.startsWith("gemini-2.5-flash-lite")) {
    return "Gemini 2.5 Flash Lite";
  }

  if (normalized.startsWith("gemini-2.5-flash")) {
    return "Gemini 2.5 Flash";
  }

  if (normalized.startsWith("gemini-2.5-pro")) {
    return "Gemini 2.5 Pro";
  }

  if (normalized.startsWith("gemini-3")) {
    return titleCaseModelName(modelName).replace(/^Gemini 3/u, "Gemini 3");
  }

  return titleCaseModelName(modelName);
};

const getHostedModels = () => {
  const inferenceProfile = getActiveInferenceProfile();

  if (inferenceProfile.provider !== "google") {
    return null;
  }

  return [
    ...env.GEMINI_AVAILABLE_MODELS.map((modelName) => ({
      family: modelName.toLowerCase().startsWith("gemini") ? "gemini" : "hosted",
      id: modelName,
      label: formatHostedModelLabel(modelName),
      modifiedAt: null,
      name: modelName,
      parameterSize: null,
      quantizationLevel: null,
      size: null,
      supportsThinking: supportsGeminiThinking(modelName)
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
