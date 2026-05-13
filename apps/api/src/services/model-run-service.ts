import { eq } from "drizzle-orm";

import { loadEnv } from "../config/env.js";
import { db } from "../db/client.js";
import { modelRuns } from "../db/schema.js";

const env = loadEnv();

type RunType =
  | "chat_response"
  | "merge_generation"
  | "path_compaction"
  | "summary_generation";
type CacheMode = "none" | "implicit" | "explicit";
type RunStatus = "queued" | "started" | "completed" | "failed";

type StartModelRunInput = {
  cacheMode?: CacheMode;
  cacheRecordId?: string | null;
  conversationId: string;
  mergeId?: string | null;
  messageId?: string | null;
  modelName: string;
  modelProvider: string;
  pathId: string;
  requestPayloadJson?: Record<string, unknown> | null;
  runType: RunType;
};

type CompleteModelRunInput = {
  cacheMode?: CacheMode;
  cacheRecordId?: string | null;
  cachedTokens?: number | null;
  inputTokens?: number | null;
  modelName?: string;
  modelProvider?: string;
  outputTokens?: number | null;
  responsePayloadJson?: Record<string, unknown> | null;
  runId: string;
};

type FailModelRunInput = {
  errorText: string;
  responsePayloadJson?: Record<string, unknown> | null;
  runId: string;
};

const toPositiveInteger = (value: number | null | undefined) => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }

  const parsed = Math.round(value);
  return parsed >= 0 ? parsed : null;
};

const toEstimatedCost = ({
  inputTokens,
  outputTokens
}: {
  inputTokens: number;
  outputTokens: number;
}) => {
  const inputCost =
    (inputTokens / 1_000_000) * env.COST_INPUT_USD_PER_MTOKENS;
  const outputCost =
    (outputTokens / 1_000_000) * env.COST_OUTPUT_USD_PER_MTOKENS;

  return Number((inputCost + outputCost).toFixed(6));
};

export const startModelRun = async ({
  cacheMode = "none",
  cacheRecordId = null,
  conversationId,
  mergeId = null,
  messageId = null,
  modelName,
  modelProvider,
  pathId,
  requestPayloadJson = null,
  runType
}: StartModelRunInput) => {
  const [run] = await db
    .insert(modelRuns)
    .values({
      cacheMode,
      cacheRecordId,
      conversationId,
      mergeId,
      messageId,
      modelName,
      modelProvider,
      pathId,
      requestPayloadJson,
      runType,
      startedAt: new Date(),
      status: "started"
    })
    .returning();

  return run;
};

export const completeModelRun = async ({
  cacheMode,
  cacheRecordId,
  cachedTokens,
  inputTokens,
  modelName,
  modelProvider,
  outputTokens,
  responsePayloadJson = null,
  runId
}: CompleteModelRunInput) => {
  const [current] = await db
    .select({
      startedAt: modelRuns.startedAt
    })
    .from(modelRuns)
    .where(eq(modelRuns.id, runId))
    .limit(1);

  const now = new Date();
  const safeInputTokens = toPositiveInteger(inputTokens) ?? 0;
  const safeOutputTokens = toPositiveInteger(outputTokens) ?? 0;
  const safeCachedTokens = toPositiveInteger(cachedTokens);
  const estimatedCost = toEstimatedCost({
    inputTokens: safeInputTokens,
    outputTokens: safeOutputTokens
  });
  const latencyMs = current?.startedAt
    ? Math.max(0, now.getTime() - current.startedAt.getTime())
    : null;

  const [updated] = await db
    .update(modelRuns)
    .set({
      cacheMode,
      cacheRecordId,
      cachedTokens: safeCachedTokens,
      completedAt: now,
      estimatedCostUsd: estimatedCost.toFixed(6),
      inputTokens: safeInputTokens,
      latencyMs,
      ...(modelName ? { modelName } : {}),
      ...(modelProvider ? { modelProvider } : {}),
      outputTokens: safeOutputTokens,
      responsePayloadJson,
      status: "completed" satisfies RunStatus
    })
    .where(eq(modelRuns.id, runId))
    .returning();

  return updated;
};

export const failModelRun = async ({
  errorText,
  responsePayloadJson = null,
  runId
}: FailModelRunInput) => {
  const [current] = await db
    .select({
      startedAt: modelRuns.startedAt
    })
    .from(modelRuns)
    .where(eq(modelRuns.id, runId))
    .limit(1);

  const now = new Date();
  const latencyMs = current?.startedAt
    ? Math.max(0, now.getTime() - current.startedAt.getTime())
    : null;

  const [updated] = await db
    .update(modelRuns)
    .set({
      completedAt: now,
      errorText,
      latencyMs,
      responsePayloadJson,
      status: "failed"
    })
    .where(eq(modelRuns.id, runId))
    .returning();

  return updated;
};
