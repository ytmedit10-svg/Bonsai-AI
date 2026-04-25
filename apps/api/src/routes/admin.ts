import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, desc, eq, gte, lte, type SQL } from "drizzle-orm";
import { z } from "zod";

import { loadEnv } from "../config/env.js";
import { db } from "../db/client.js";
import { modelRuns } from "../db/schema.js";

const env = loadEnv();

const summaryQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional()
});

const runsQuerySchema = z.object({
  conversationId: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  pathId: z.string().uuid().optional(),
  runType: z.enum(["chat_response", "merge_generation", "summary_generation"]).optional(),
  status: z.enum(["queued", "started", "completed", "failed"]).optional(),
  to: z.string().datetime().optional()
});

const toNumber = (value: unknown) => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
};

const calculateP95 = (values: number[]) => {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[index] ?? 0;
};

const requireAdminAccess = (request: FastifyRequest, reply: FastifyReply) => {
  if (!env.API_ADMIN_KEY?.trim()) {
    void reply.code(503).send({
      error: "Admin access is not configured."
    });
    return false;
  }

  const providedKey = request.headers["x-admin-key"];

  if (typeof providedKey !== "string" || providedKey !== env.API_ADMIN_KEY) {
    void reply.code(401).send({
      error: "Unauthorized."
    });
    return false;
  }

  return true;
};

const buildRunFilters = (query: z.infer<typeof runsQuerySchema>) => {
  const clauses: SQL[] = [];

  if (query.conversationId) {
    clauses.push(eq(modelRuns.conversationId, query.conversationId));
  }

  if (query.pathId) {
    clauses.push(eq(modelRuns.pathId, query.pathId));
  }

  if (query.status) {
    clauses.push(eq(modelRuns.status, query.status));
  }

  if (query.runType) {
    clauses.push(eq(modelRuns.runType, query.runType));
  }

  if (query.from) {
    clauses.push(gte(modelRuns.createdAt, new Date(query.from)));
  }

  if (query.to) {
    clauses.push(lte(modelRuns.createdAt, new Date(query.to)));
  }

  if (clauses.length === 0) {
    return undefined;
  }

  return and(...clauses);
};

export const registerAdminRoutes = (server: FastifyInstance) => {
  server.get("/admin/observability/summary", async (request, reply) => {
    if (!requireAdminAccess(request, reply)) {
      return;
    }

    const query = summaryQuerySchema.parse(request.query);
    const whereClauses: SQL[] = [];

    if (query.from) {
      whereClauses.push(gte(modelRuns.createdAt, new Date(query.from)));
    }

    if (query.to) {
      whereClauses.push(lte(modelRuns.createdAt, new Date(query.to)));
    }

    const runs = await db.query.modelRuns.findMany({
      columns: {
        cacheMode: true,
        cachedTokens: true,
        estimatedCostUsd: true,
        inputTokens: true,
        latencyMs: true,
        outputTokens: true,
        status: true
      },
      where: whereClauses.length > 0 ? and(...whereClauses) : undefined
    });

    const totalRuns = runs.length;
    const completedRuns = runs.filter((run) => run.status === "completed");
    const failedRuns = runs.filter((run) => run.status === "failed");
    const explicitCacheRuns = runs.filter((run) => run.cacheMode === "explicit");
    const latencyValues = completedRuns
      .map((run) => run.latencyMs ?? 0)
      .filter((latency) => latency > 0);

    const totals = runs.reduce(
      (accumulator, run) => ({
        cachedTokens: accumulator.cachedTokens + (run.cachedTokens ?? 0),
        estimatedCostUsd: accumulator.estimatedCostUsd + toNumber(run.estimatedCostUsd),
        inputTokens: accumulator.inputTokens + (run.inputTokens ?? 0),
        outputTokens: accumulator.outputTokens + (run.outputTokens ?? 0)
      }),
      {
        cachedTokens: 0,
        estimatedCostUsd: 0,
        inputTokens: 0,
        outputTokens: 0
      }
    );

    return reply.send({
      runs: {
        completed: completedRuns.length,
        failed: failedRuns.length,
        total: totalRuns
      },
      tokens: totals,
      cache: {
        explicitRuns: explicitCacheRuns.length,
        hitRate:
          totalRuns > 0
            ? Number(((explicitCacheRuns.length / totalRuns) * 100).toFixed(2))
            : 0
      },
      latency: {
        p50Ms:
          latencyValues.length > 0
            ? latencyValues.sort((left, right) => left - right)[
                Math.floor(latencyValues.length * 0.5)
              ] ?? 0
            : 0,
        p95Ms: calculateP95(latencyValues)
      },
      cost: {
        estimatedUsd: Number(totals.estimatedCostUsd.toFixed(6))
      }
    });
  });

  server.get("/admin/observability/runs", async (request, reply) => {
    if (!requireAdminAccess(request, reply)) {
      return;
    }

    const query = runsQuerySchema.parse(request.query);

    const runs = await db.query.modelRuns.findMany({
      orderBy: [desc(modelRuns.createdAt)],
      limit: query.limit,
      where: buildRunFilters(query)
    });

    return reply.send({
      runs
    });
  });
};
