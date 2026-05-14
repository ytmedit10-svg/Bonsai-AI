import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
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

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const workspaceRoot = path.resolve(currentDir, "../../..");
const webDistDir = path.join(workspaceRoot, "apps/web/dist");
const webIndexHtml = path.join(webDistDir, "index.html");

export const buildServer = () => {
  const server = Fastify({
    bodyLimit: 12 * 1024 * 1024,
    logger: true
  });

  void server.register(cors, {
    origin: true
  });

  server.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      void reply.code(400).send(
        buildApiError({
          action: "Review request",
          code: "VALIDATION_ERROR",
          message: error.issues[0]?.message ?? "The request was invalid.",
          reason: "validation_failed",
          title: "Request needs a small fix",
          type: "validation"
        })
      );
      return;
    }

    request.log.error(error);
    void reply.code(500).send(
      buildApiError({
        action: "Retry",
        code: "INTERNAL_ERROR",
        message: "Bonsai hit an internal error. Retry once, then inspect the failed run if it repeats.",
        reason: "internal_error",
        retryable: true,
        title: "Bonsai hit an internal error",
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

  if (fs.existsSync(webIndexHtml)) {
    void server.register(fastifyStatic, {
      root: webDistDir,
      wildcard: false
    });

    server.setNotFoundHandler((request, reply) => {
      if (request.method !== "GET") {
        void reply.code(404).send(
          buildApiError({
            action: "Review route",
            code: "NOT_FOUND",
            message: "Route not found.",
            reason: "route_not_found",
            title: "Route not found",
            type: "validation"
          })
        );
        return;
      }

      void reply.type("text/html").sendFile("index.html");
    });
  } else {
    server.get("/", async () => {
      return {
        ok: true,
        service: "api",
        message: "Bonsai AI API is running."
      };
    });
  }

  return server;
};
