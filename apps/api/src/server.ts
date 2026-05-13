import cors from "@fastify/cors";
import Fastify from "fastify";
import { ZodError } from "zod";

import { registerAttachmentRoutes } from "./routes/attachments.js";
import { registerConversationRoutes } from "./routes/conversations.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerMergeRoutes } from "./routes/merges.js";
import { registerModelRoutes } from "./routes/models.js";
import { registerPathRoutes } from "./routes/paths.js";
import { registerRetrievalRoutes } from "./routes/retrieval.js";
import { registerSearchRoutes } from "./routes/search.js";
import { buildApiError } from "./services/api-error.js";

export const buildServer = () => {
  const server = Fastify({
    bodyLimit: 12 * 1024 * 1024,
    logger: true
  });

  void server.register(cors, {
    origin: true
  });

  server.get("/", async () => {
    return {
      ok: true,
      service: "api",
      message: "Bonsai AI API is running."
    };
  });

  server.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      void reply.code(400).send(
        buildApiError({
          code: "VALIDATION_ERROR",
          message: error.issues[0]?.message ?? "The request was invalid.",
          type: "validation"
        })
      );
      return;
    }

    request.log.error(error);
    void reply.code(500).send(
      buildApiError({
        code: "INTERNAL_ERROR",
        message: "The app hit an internal error. Try again, then inspect the run if it repeats.",
        retryable: true,
        type: "app"
      })
    );
  });

  registerHealthRoutes(server);
  registerAdminRoutes(server);
  registerAttachmentRoutes(server);
  registerConversationRoutes(server);
  registerMergeRoutes(server);
  registerModelRoutes(server);
  registerPathRoutes(server);
  registerRetrievalRoutes(server);
  registerSearchRoutes(server);

  return server;
};
