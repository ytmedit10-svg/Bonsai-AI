import { randomUUID } from "node:crypto";

import { and, desc, eq, inArray } from "drizzle-orm";

import { loadEnv } from "../config/env.js";
import { db, pool } from "../db/client.js";
import { jobs, type Job } from "../db/schema.js";

const env = loadEnv();

export type JobType =
  | "attachment_cleanup"
  | "cache_expiry"
  | "path_compaction"
  | "semantic_embedding";
export type JobStatus = "completed" | "failed" | "queued" | "running";

type EnqueueJobInput = {
  dedupeKey?: string | null;
  jobType: JobType;
  maxAttempts?: number;
  payloadJson?: Record<string, unknown> | null;
  runAfter?: Date;
};

type ClaimedJobRow = {
  id: string;
  job_type: string;
  status: string;
  dedupe_key: string | null;
  payload_json: unknown;
  attempts: number;
  max_attempts: number;
  run_after: Date;
  locked_at: Date | null;
  locked_by: string | null;
  completed_at: Date | null;
  error_text: string | null;
  created_at: Date;
  updated_at: Date;
};

const mapClaimedJob = (row: ClaimedJobRow): Job => ({
  attempts: row.attempts,
  completedAt: row.completed_at,
  createdAt: row.created_at,
  dedupeKey: row.dedupe_key,
  errorText: row.error_text,
  id: row.id,
  jobType: row.job_type,
  lockedAt: row.locked_at,
  lockedBy: row.locked_by,
  maxAttempts: row.max_attempts,
  payloadJson: row.payload_json,
  runAfter: row.run_after,
  status: row.status,
  updatedAt: row.updated_at
});

export const enqueueJob = async ({
  dedupeKey = null,
  jobType,
  maxAttempts = 3,
  payloadJson = null,
  runAfter = new Date()
}: EnqueueJobInput) => {
  const [job] = await db
    .insert(jobs)
    .values({
      dedupeKey,
      jobType,
      maxAttempts,
      payloadJson,
      runAfter,
      status: "queued"
    })
    .returning();

  return job;
};

export const enqueueSingletonJob = async (input: EnqueueJobInput) => {
  if (input.dedupeKey) {
    const existing = await db.query.jobs.findFirst({
      orderBy: [desc(jobs.createdAt)],
      where: and(
        eq(jobs.dedupeKey, input.dedupeKey),
        inArray(jobs.status, ["queued", "running"])
      )
    });

    if (existing) {
      return existing;
    }
  }

  return enqueueJob(input);
};

export const claimNextJob = async ({
  jobTypes,
  workerId = randomUUID()
}: {
  jobTypes?: JobType[];
  workerId?: string;
}) => {
  const staleBefore = new Date(Date.now() - env.JOB_LOCK_TIMEOUT_SECONDS * 1000);
  const result = await pool.query<ClaimedJobRow>(
    `
      WITH candidate AS (
        SELECT id
        FROM jobs
        WHERE
          (
            (
              status = 'queued'
              AND run_after <= now()
            )
            OR (
              status = 'running'
              AND locked_at IS NOT NULL
              AND locked_at < $1
            )
          )
          AND ($2::text[] IS NULL OR job_type = ANY($2::text[]))
        ORDER BY run_after ASC, created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE jobs
      SET
        attempts = attempts + 1,
        error_text = NULL,
        locked_at = now(),
        locked_by = $3,
        status = 'running',
        updated_at = now()
      WHERE id = (SELECT id FROM candidate)
      RETURNING *
    `,
    [staleBefore, jobTypes?.length ? jobTypes : null, workerId]
  );

  const row = result.rows[0];
  return row ? mapClaimedJob(row) : null;
};

export const completeJob = async (jobId: string) => {
  const [job] = await db
    .update(jobs)
    .set({
      completedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      status: "completed",
      updatedAt: new Date()
    })
    .where(eq(jobs.id, jobId))
    .returning();

  return job ?? null;
};

export const failJob = async ({
  errorText,
  job
}: {
  errorText: string;
  job: Job;
}) => {
  const shouldRetry = job.attempts < job.maxAttempts;
  const backoffSeconds = Math.min(300, Math.max(5, 2 ** job.attempts * 5));
  const [updated] = await db
    .update(jobs)
    .set({
      errorText,
      lockedAt: null,
      lockedBy: null,
      runAfter: shouldRetry
        ? new Date(Date.now() + backoffSeconds * 1000)
        : job.runAfter,
      status: shouldRetry ? "queued" : "failed",
      updatedAt: new Date()
    })
    .where(eq(jobs.id, job.id))
    .returning();

  return updated ?? null;
};

export const listJobs = async ({
  limit = 100,
  status
}: {
  limit?: number;
  status?: JobStatus;
} = {}) => {
  return db.query.jobs.findMany({
    limit,
    orderBy: [desc(jobs.createdAt)],
    where: status ? eq(jobs.status, status) : undefined
  });
};
