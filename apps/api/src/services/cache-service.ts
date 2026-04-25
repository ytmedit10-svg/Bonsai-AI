import { createHash } from "node:crypto";

import type { GoogleGenAI } from "@google/genai";
import { and, eq, gt, lte } from "drizzle-orm";

import { loadEnv } from "../config/env.js";
import { db } from "../db/client.js";
import { cacheRecords } from "../db/schema.js";

const env = loadEnv();
const APPROX_CHARS_PER_TOKEN = 4;
const unsupportedExplicitCacheModels = new Set<string>();

export type CacheScope = "system_prefix" | "split_snapshot" | "docs_bundle" | "merge_context";

type ResolveSplitSnapshotCacheInput = {
  ai: GoogleGenAI;
  conversationId?: string | null;
  modelName: string;
  pathId?: string | null;
  snapshotText: string;
  systemInstruction: string;
  ttlSeconds?: number;
};

type SplitSnapshotCachePlan =
  | {
      mode: "implicit";
      reason:
        | "disabled"
        | "missing_snapshot"
        | "model_unsupported"
        | "prefix_too_small"
        | "create_failed";
      tokenEstimate: number;
    }
  | {
      mode: "explicit";
      cacheRecordId: string;
      cachedContentName: string;
      created: boolean;
      tokenEstimate: number;
    };

const estimateTokenCount = (value: string) =>
  Math.max(1, Math.ceil(value.length / APPROX_CHARS_PER_TOKEN));

const getErrorStatusCode = (error: unknown) => {
  if (!error || typeof error !== "object" || !("status" in error)) {
    return null;
  }

  return typeof error.status === "number" ? error.status : null;
};

const isModelUnsupportedForExplicitCache = (error: unknown) => {
  const statusCode = getErrorStatusCode(error);
  return statusCode === 400 || statusCode === 404 || statusCode === 501;
};

const buildContentHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const buildCacheKey = ({
  cacheScope,
  contentHash,
  modelName
}: {
  cacheScope: CacheScope;
  contentHash: string;
  modelName: string;
}) => `${cacheScope}:${modelName}:${contentHash}`;

export const buildSplitSnapshotContextText = (snapshotText: string) =>
  `Inherited branch memory snapshot:\n\n${snapshotText.trim()}`;

const getReusableCache = async ({
  cacheKey,
  contentHash,
  modelName
}: {
  cacheKey: string;
  contentHash: string;
  modelName: string;
}) => {
  return db.query.cacheRecords.findFirst({
    where: and(
      eq(cacheRecords.cacheKey, cacheKey),
      eq(cacheRecords.contentHash, contentHash),
      eq(cacheRecords.modelName, modelName),
      eq(cacheRecords.status, "active"),
      gt(cacheRecords.expiresAt, new Date())
    )
  });
};

export const markCacheUsed = async (cacheRecordId: string) => {
  await db
    .update(cacheRecords)
    .set({
      lastUsedAt: new Date()
    })
    .where(eq(cacheRecords.id, cacheRecordId));
};

export const expireStaleCaches = async () => {
  await db
    .update(cacheRecords)
    .set({
      status: "expired"
    })
    .where(
      and(eq(cacheRecords.status, "active"), lte(cacheRecords.expiresAt, new Date()))
    );
};

export const resolveSplitSnapshotCache = async ({
  ai,
  conversationId = null,
  modelName,
  pathId = null,
  snapshotText,
  systemInstruction,
  ttlSeconds = env.DEFAULT_SPLIT_SNAPSHOT_TTL_SECONDS
}: ResolveSplitSnapshotCacheInput): Promise<SplitSnapshotCachePlan> => {
  const normalizedSnapshot = snapshotText.trim();

  if (!normalizedSnapshot) {
    return {
      mode: "implicit",
      reason: "missing_snapshot",
      tokenEstimate: 0
    };
  }

  const stablePrefixText = [systemInstruction, buildSplitSnapshotContextText(normalizedSnapshot)]
    .filter(Boolean)
    .join("\n\n");
  const tokenEstimate = estimateTokenCount(stablePrefixText);

  if (!env.ENABLE_EXPLICIT_CACHE) {
    return {
      mode: "implicit",
      reason: "disabled",
      tokenEstimate
    };
  }

  if (tokenEstimate < env.MIN_EXPLICIT_CACHE_TOKENS) {
    return {
      mode: "implicit",
      reason: "prefix_too_small",
      tokenEstimate
    };
  }

  if (unsupportedExplicitCacheModels.has(modelName)) {
    return {
      mode: "implicit",
      reason: "model_unsupported",
      tokenEstimate
    };
  }

  const contentHash = buildContentHash(stablePrefixText);
  const cacheKey = buildCacheKey({
    cacheScope: "split_snapshot",
    contentHash,
    modelName
  });

  const reusable = await getReusableCache({
    cacheKey,
    contentHash,
    modelName
  });

  if (reusable) {
    await markCacheUsed(reusable.id);

    return {
      mode: "explicit",
      cacheRecordId: reusable.id,
      cachedContentName: reusable.geminiCachedContentName,
      created: false,
      tokenEstimate
    };
  }

  const safeTtlSeconds = Math.max(60, ttlSeconds);

  try {
    const createdCache = await ai.caches.create({
      model: modelName,
      config: {
        displayName: `split-snapshot-${pathId ?? "global"}`,
        ttl: `${safeTtlSeconds}s`,
        systemInstruction,
        contents: [
          {
            role: "user",
            parts: [
              {
                text: buildSplitSnapshotContextText(normalizedSnapshot)
              }
            ]
          }
        ]
      }
    });

    const cachedContentName = createdCache.name?.trim();

    if (!cachedContentName) {
      return {
        mode: "implicit",
        reason: "create_failed",
        tokenEstimate
      };
    }

    const now = new Date();
    const expiresAt = createdCache.expireTime
      ? new Date(createdCache.expireTime)
      : new Date(now.getTime() + safeTtlSeconds * 1000);

    const [record] = await db
      .insert(cacheRecords)
      .values({
        conversationId,
        pathId,
        cacheKey,
        cacheScope: "split_snapshot",
        modelName,
        geminiCachedContentName: cachedContentName,
        contentHash,
        tokenEstimate,
        ttlSeconds: safeTtlSeconds,
        status: "active",
        lastUsedAt: now,
        expiresAt
      })
      .onConflictDoUpdate({
        target: cacheRecords.cacheKey,
        set: {
          conversationId,
          pathId,
          modelName,
          geminiCachedContentName: cachedContentName,
          contentHash,
          tokenEstimate,
          ttlSeconds: safeTtlSeconds,
          status: "active",
          lastUsedAt: now,
          expiresAt
        }
      })
      .returning();

    return {
      mode: "explicit",
      cacheRecordId: record.id,
      cachedContentName,
      created: true,
      tokenEstimate
    };
  } catch (error) {
    if (isModelUnsupportedForExplicitCache(error)) {
      unsupportedExplicitCacheModels.add(modelName);
    }

    return {
      mode: "implicit",
      reason: unsupportedExplicitCacheModels.has(modelName)
        ? "model_unsupported"
        : "create_failed",
      tokenEstimate
    };
  }
};
