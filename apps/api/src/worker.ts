import { randomUUID } from "node:crypto";

import { loadEnv } from "./config/env.js";
import { pool } from "./db/client.js";
import { cleanupOrphanedUploads } from "./services/attachment-service.js";
import { expireStaleCaches } from "./services/cache-service.js";
import { maybeCompactPath } from "./services/compaction-service.js";
import { processEmbeddingJob } from "./services/embedding-service.js";
import {
  claimNextJob,
  completeJob,
  enqueueSingletonJob,
  failJob,
  type JobType
} from "./services/job-service.js";

const env = loadEnv();
const workerId = `worker-${randomUUID()}`;
const jobTypes: JobType[] = [
  "attachment_cleanup",
  "cache_expiry",
  "path_compaction",
  "semantic_embedding"
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const getNumber = (
  value: Record<string, unknown>,
  key: string,
  fallback: number
) => {
  const raw = value[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
};

const runJob = async (jobType: string, payload: unknown) => {
  const input = isRecord(payload) ? payload : {};

  if (jobType === "attachment_cleanup") {
    return cleanupOrphanedUploads({
      limit: getNumber(input, "limit", 50),
      olderThanMinutes: getNumber(input, "olderThanMinutes", 60)
    });
  }

  if (jobType === "cache_expiry") {
    await expireStaleCaches();
    return {
      expired: true
    };
  }

  if (jobType === "path_compaction") {
    const pathId = typeof input.pathId === "string" ? input.pathId : null;
    const userId = typeof input.userId === "string" ? input.userId : null;
    const modelName = typeof input.modelName === "string" ? input.modelName : null;
    const thinkingEnabled = input.thinkingEnabled === true;
    const reason =
      input.reason === "manual" || input.reason === "after_assistant_response"
        ? input.reason
        : "after_assistant_response";

    if (!pathId || !userId) {
      throw new Error("path_compaction job requires pathId and userId.");
    }

    return maybeCompactPath({
      modelName,
      pathId,
      reason,
      thinkingEnabled,
      userId
    });
  }

  if (jobType === "semantic_embedding") {
    return processEmbeddingJob(payload);
  }

  throw new Error(`Unsupported job type: ${jobType}`);
};

const enqueueMaintenanceJobs = async () => {
  await Promise.all([
    enqueueSingletonJob({
      dedupeKey: "maintenance:attachment_cleanup",
      jobType: "attachment_cleanup",
      maxAttempts: 5,
      payloadJson: {
        limit: 50,
        olderThanMinutes: 60
      }
    }),
    enqueueSingletonJob({
      dedupeKey: "maintenance:cache_expiry",
      jobType: "cache_expiry",
      maxAttempts: 5
    })
  ]);
};

const start = async () => {
  console.log(`${env.APP_NAME} worker ${workerId} started`);

  let nextMaintenanceAt = 0;

  while (true) {
    const now = Date.now();

    if (now >= nextMaintenanceAt) {
      await enqueueMaintenanceJobs();
      nextMaintenanceAt = now + env.JOB_MAINTENANCE_INTERVAL_SECONDS * 1000;
    }

    const job = await claimNextJob({
      jobTypes,
      workerId
    });

    if (!job) {
      await sleep(env.JOB_POLL_INTERVAL_MS);
      continue;
    }

    try {
      const result = await runJob(job.jobType, job.payloadJson);
      await completeJob(job.id);
      console.log(`completed ${job.jobType} ${job.id}`, result);
    } catch (error) {
      const errorText = error instanceof Error ? error.message : "Job failed.";
      await failJob({
        errorText,
        job
      });
      console.error(`failed ${job.jobType} ${job.id}: ${errorText}`);
    }
  }
};

const shutdown = async () => {
  await pool.end();
  process.exit(0);
};

process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});

void start().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});
