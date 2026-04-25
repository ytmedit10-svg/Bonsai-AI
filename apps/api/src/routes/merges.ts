import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { ensureBootstrapUser } from "../services/bootstrap-user-service.js";
import { MissingAiProviderApiKeyError } from "../services/ai-adapter.js";
import { getMergeById, requestMerge } from "../services/merge-service.js";

const createMergeSchema = z.object({
  acknowledgeOutdated: z.boolean().optional(),
  mergeMode: z.enum(["light", "full", "reference", "collapse"]).default("light"),
  sourcePathId: z.string().uuid(),
  targetPathId: z.string().uuid().optional()
});

const mergeParamsSchema = z.object({
  mergeId: z.string().uuid()
});

const getProviderError = (error: unknown) => {
  if (!error || typeof error !== "object") {
    return null;
  }

  const maybeStatus = "status" in error ? error.status : null;
  const maybeMessage = "message" in error ? error.message : null;

  if (typeof maybeStatus === "number" && typeof maybeMessage === "string") {
    let message = maybeMessage;

    try {
      const parsedOuter = JSON.parse(maybeMessage) as {
        error?: {
          message?: string;
        };
      };

      if (parsedOuter.error?.message) {
        try {
          const parsedInner = JSON.parse(parsedOuter.error.message) as {
            error?: {
              message?: string;
            };
          };

          message = parsedInner.error?.message ?? parsedOuter.error.message;
        } catch {
          message = parsedOuter.error.message;
        }
      }
    } catch {
      message = maybeMessage;
    }

    return {
      message,
      statusCode: maybeStatus
    };
  }

  return null;
};

export const registerMergeRoutes = (server: FastifyInstance) => {
  server.post("/merges", async (request, reply) => {
    const body = createMergeSchema.parse(request.body);
    const user = await ensureBootstrapUser();

    try {
      const result = await requestMerge({
        acknowledgeOutdated: body.acknowledgeOutdated,
        mergeMode: body.mergeMode,
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
        return reply.code(503).send({
          error: error.message
        });
      }

      const providerError = getProviderError(error);

      if (providerError) {
        return reply.code(providerError.statusCode).send({
          error: providerError.message
        });
      }

      request.log.error(error);

      return reply.code(500).send({
        error: "Failed to create merge."
      });
    }
  });

  server.get("/merges/:mergeId", async (request, reply) => {
    const params = mergeParamsSchema.parse(request.params);
    const user = await ensureBootstrapUser();

    const result = await getMergeById(params.mergeId, user.id);

    if (!result) {
      return reply.code(404).send({
        error: "Merge not found."
      });
    }

    return reply.send(result);
  });
};
