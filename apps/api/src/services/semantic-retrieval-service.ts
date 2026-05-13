import { and, desc, eq, inArray, type SQL } from "drizzle-orm";

import { db } from "../db/client.js";
import {
  conversations,
  embeddingRecords,
  paths,
  type EmbeddingRecord
} from "../db/schema.js";
import {
  cosineSimilarity,
  embedText,
  getEmbeddingProfile
} from "./embedding-adapter.js";
import type { EmbeddingSourceType } from "./embedding-service.js";

export type SemanticRetrievalResult = {
  contentText: string;
  conversationId: string;
  createdAt: string;
  pathId: string | null;
  score: number;
  snippet: string;
  sourceId: string;
  sourceType: EmbeddingSourceType;
  title: string;
  tokenEstimate: number | null;
};

type SemanticRetrievalInput = {
  conversationId?: string;
  excludeSources?: Array<{
    sourceId: string;
    sourceType?: string;
  }>;
  limit: number;
  pathId?: string;
  query: string;
  sourceTypes?: EmbeddingSourceType[];
  userId: string;
};

const SNIPPET_LIMIT = 220;

const toSnippet = (value: string) => {
  const normalized = value.replace(/\s+/g, " ").trim();

  return normalized.length > SNIPPET_LIMIT
    ? `${normalized.slice(0, SNIPPET_LIMIT - 3).trimEnd()}...`
    : normalized;
};

const isNumberArray = (value: unknown): value is number[] =>
  Array.isArray(value) &&
  value.every((item) => typeof item === "number" && Number.isFinite(item));

const getMetadataTitle = (metadata: unknown) => {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  const title = (metadata as Record<string, unknown>).title;
  return typeof title === "string" && title.trim() ? title : null;
};

const normalizeScore = (score: number) => Number(score.toFixed(6));

const calculateScopeBoost = ({
  activePath,
  record
}: {
  activePath: {
    id: string;
    parentPathId: string | null;
    rootPathId: string | null;
  } | null;
  record: EmbeddingRecord;
}) => {
  if (!activePath || !record.pathId) {
    return 0;
  }

  if (record.pathId === activePath.id) {
    return 0.08;
  }

  if (record.pathId === activePath.parentPathId) {
    return 0.04;
  }

  if (record.pathId === activePath.rootPathId) {
    return 0.035;
  }

  return 0;
};

const toSemanticResult = ({
  activePath,
  queryVector,
  record
}: {
  activePath: Awaited<ReturnType<typeof getActivePath>>;
  queryVector: number[];
  record: EmbeddingRecord;
}): SemanticRetrievalResult | null => {
  if (!isNumberArray(record.embeddingJson)) {
    return null;
  }

  const semanticScore = cosineSimilarity(queryVector, record.embeddingJson);
  const score = semanticScore + calculateScopeBoost({ activePath, record });

  if (score <= 0) {
    return null;
  }

  return {
    contentText: record.contentText,
    conversationId: record.conversationId,
    createdAt: record.createdAt.toISOString(),
    pathId: record.pathId,
    score: normalizeScore(score),
    snippet: toSnippet(record.contentText),
    sourceId: record.sourceId,
    sourceType: record.sourceType as EmbeddingSourceType,
    title: getMetadataTitle(record.metadataJson) ?? record.sourceType.replace(/_/g, " "),
    tokenEstimate: record.tokenEstimate
  };
};

const getActivePath = async (pathId?: string) => {
  if (!pathId) {
    return null;
  }

  return db.query.paths.findFirst({
    columns: {
      id: true,
      parentPathId: true,
      rootPathId: true
    },
    where: eq(paths.id, pathId)
  }).then((path) => path ?? null);
};

export const getSemanticRetrievalCandidates = async ({
  conversationId,
  excludeSources = [],
  limit,
  pathId,
  query,
  sourceTypes,
  userId
}: SemanticRetrievalInput) => {
  const normalizedQuery = query.trim();

  if (!normalizedQuery) {
    return [];
  }

  const profile = getEmbeddingProfile();
  const embeddedQuery = await embedText(normalizedQuery);
  const whereClauses: SQL[] = [
    eq(conversations.userId, userId),
    eq(embeddingRecords.embeddingModel, profile.model),
    eq(embeddingRecords.embeddingDimensions, profile.dimensions)
  ];

  if (conversationId) {
    whereClauses.push(eq(embeddingRecords.conversationId, conversationId));
  }

  if (sourceTypes?.length) {
    whereClauses.push(inArray(embeddingRecords.sourceType, sourceTypes));
  }

  const [activePath, records] = await Promise.all([
    getActivePath(pathId),
    db
      .select()
      .from(embeddingRecords)
      .innerJoin(conversations, eq(conversations.id, embeddingRecords.conversationId))
      .where(and(...whereClauses))
      .orderBy(desc(embeddingRecords.updatedAt))
      .limit(Math.max(limit * 12, 60))
      .then((rows) => rows.map((row) => row.embedding_records))
  ]);
  const excluded = new Set(
    excludeSources.map((source) =>
      source.sourceType ? `${source.sourceType}:${source.sourceId}` : source.sourceId
    )
  );

  return records
    .filter((record) => {
      const typedKey = `${record.sourceType}:${record.sourceId}`;
      return !excluded.has(record.sourceId) && !excluded.has(typedKey);
    })
    .map((record) =>
      toSemanticResult({
        activePath,
        queryVector: embeddedQuery.vector,
        record
      })
    )
    .filter((result): result is SemanticRetrievalResult => Boolean(result))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
};
