import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { ensureRequestUser } from "../services/bootstrap-user-service.js";
import { searchWorkspace } from "../services/search-service.js";

const searchQuerySchema = z.object({
  conversationId: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(50).default(20),
  pathId: z.string().uuid().optional(),
  q: z.string().trim().min(1).max(200),
  sourceType: z
    .enum([
      "attachment",
      "conversation",
      "memory_artifact",
      "message",
      "path",
      "path_snapshot"
    ])
    .optional()
});

export const registerSearchRoutes = (server: FastifyInstance) => {
  server.get("/search", async (request) => {
    const query = searchQuerySchema.parse(request.query);
    const user = await ensureRequestUser(request);
    const results = await searchWorkspace({
      conversationId: query.conversationId,
      limit: query.limit,
      pathId: query.pathId,
      query: query.q,
      sourceType: query.sourceType,
      userId: user.id
    });

    return {
      query: query.q,
      results
    };
  });
};
