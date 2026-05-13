import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { ensureRequestUser } from "../services/bootstrap-user-service.js";
import { getHybridRetrievalCandidates } from "../services/hybrid-retrieval-service.js";
import { getSemanticRetrievalCandidates } from "../services/semantic-retrieval-service.js";

const retrievalQuerySchema = z.object({
  conversationId: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(50).default(12),
  pathId: z.string().uuid().optional(),
  q: z.string().trim().min(1).max(500)
});

export const registerRetrievalRoutes = (server: FastifyInstance) => {
  server.get("/retrieval/semantic", async (request) => {
    const query = retrievalQuerySchema.parse(request.query);
    const user = await ensureRequestUser(request);
    const results = await getSemanticRetrievalCandidates({
      conversationId: query.conversationId,
      limit: query.limit,
      pathId: query.pathId,
      query: query.q,
      userId: user.id
    });

    return {
      query: query.q,
      results
    };
  });

  server.get("/retrieval/hybrid", async (request) => {
    const query = retrievalQuerySchema.parse(request.query);
    const user = await ensureRequestUser(request);
    const results = await getHybridRetrievalCandidates({
      conversationId: query.conversationId,
      limit: query.limit,
      pathId: query.pathId,
      query: query.q,
      userId: user.id
    });

    return {
      query: query.q,
      results
    };
  });
};
