import cors from "@fastify/cors";
import Fastify from "fastify";

import { registerConversationRoutes } from "./routes/conversations.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerMergeRoutes } from "./routes/merges.js";
import { registerPathRoutes } from "./routes/paths.js";

export const buildServer = () => {
  const server = Fastify({
    logger: true
  });

  void server.register(cors, {
    origin: true
  });

  server.get("/", async () => {
    return {
      ok: true,
      service: "api",
      message: "Node-based Chat API scaffold is running."
    };
  });

  registerHealthRoutes(server);
  registerAdminRoutes(server);
  registerConversationRoutes(server);
  registerMergeRoutes(server);
  registerPathRoutes(server);

  return server;
};
