import type { FastifyInstance } from "fastify";

export const registerHealthRoutes = (server: FastifyInstance) => {
  server.get("/health", async () => {
    return {
      ok: true,
      timestamp: new Date().toISOString()
    };
  });
};

