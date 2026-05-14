import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { ensureRequestUser } from "../services/bootstrap-user-service.js";
import { MissingAiProviderApiKeyError } from "../services/ai-adapter.js";
import {
  buildApiError,
  buildProviderApiError,
  getProviderStatusCode
} from "../services/api-error.js";
import { getMergeById, requestMerge } from "../services/merge-service.js";

const createMergeSchema = z.object({
  acknowledgeOutdated: z.boolean().optional(),
  mergeMode: z.enum(["light", "full", "reference", "collapse"]).default("light"),
  modelName: z.string().trim().min(1).max(120).optional(),
  thinkingEnabled: z.boolean().optional().default(false),
  sourcePathId: z.string().uuid(),
  targetPathId: z.string().uuid().optional()
});

const mergeParamsSchema = z.object({
  mergeId: z.string().uuid()
});

export const registerMergeRoutes = (server: FastifyInstance) => {
  server.post("/merges", async (request, reply) => {
    const body = createMergeSchema.parse(request.body);
    const user = await ensureRequestUser(request);

    try {
      const result = await requestMerge({
        acknowledgeOutdated: body.acknowledgeOutdated,
        mergeMode: body.mergeMode,
        modelName: body.modelName ?? null,
        thinkingEnabled: body.thinkingEnabled,
        sourcePathId: body.sourcePathId,
        targetPathId: body.targetPathId,
        userId: user.id
      });

      if (!result) {
        return reply.code(404).send({
          error: "Source branch not found."
        });
      }

      if ("requiresConfirmation" in result) {
        return reply.code(409).send(result);
      }

      if ("error" in result) {
        const statusCode = result.merge ? 502 : 400;

        return reply.code(statusCode).send(result);
      }

      return reply.code(201).send(result);
    } catch (error) {
      if (error instanceof MissingAiProviderApiKeyError) {
        return reply.code(503).send(
          buildApiError({
            action: "Configure key",
            code: "AI_PROVIDER_MISSING_KEY",
            message: "Hosted AI is not configured for this deployment.",
            reason: "provider_missing_key",
            retryable: false,
            title: "Hosted AI is not configured",
            type: "provider"
          })
        );
      }

      const providerError = buildProviderApiError(
        error,
        "Failed to create merge."
      );

      if (providerError.error.code !== "AI_PROVIDER_FAILED") {
        return reply.code(getProviderStatusCode(error) ?? 500).send(providerError);
      }

      request.log.error(error);

      return reply.code(500).send(
        buildApiError({
          action: "Retry",
          code: "MERGE_FAILED",
          message: "Bonsai could not merge that branch. Retry once, then inspect the failed run if it repeats.",
          reason: "merge_failed",
          retryable: true,
          title: "Merge failed",
          type: "app"
        })
      );
    }
  });

  server.get("/merges/:mergeId", async (request, reply) => {
    const params = mergeParamsSchema.parse(request.params);
    const user = await ensureRequestUser(request);

    const result = await getMergeById(params.mergeId, user.id);

    if (!result) {
      return reply.code(404).send({
        error: "Merge not found."
      });
    }

    return reply.send(result);
  });
};
