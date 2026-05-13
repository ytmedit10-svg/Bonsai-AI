import type { SearchResult } from "./search-service.js";
import { searchWorkspace } from "./search-service.js";
import {
  getSemanticRetrievalCandidates,
  type SemanticRetrievalResult
} from "./semantic-retrieval-service.js";

export type HybridRetrievalResult = {
  channels: Array<"search" | "semantic">;
  contentText: string;
  conversationId: string;
  createdAt: string;
  pathId: string | null;
  score: number;
  snippet: string;
  sourceId: string;
  sourceType: string;
  title: string;
};

type HybridRetrievalInput = {
  conversationId?: string;
  excludeSources?: Array<{
    sourceId: string;
    sourceType?: string;
  }>;
  limit: number;
  pathId?: string;
  query: string;
  userId: string;
};

const toKey = (result: Pick<HybridRetrievalResult, "sourceId" | "sourceType">) =>
  `${result.sourceType}:${result.sourceId}`;

const fromSearchResult = (result: SearchResult): HybridRetrievalResult => ({
  channels: ["search"],
  contentText: result.snippet,
  conversationId: result.conversationId,
  createdAt: result.createdAt,
  pathId: result.pathId,
  score: Number((Math.min(1, result.rank) + 0.05).toFixed(6)),
  snippet: result.snippet,
  sourceId: result.sourceId,
  sourceType: result.sourceType,
  title: result.title
});

const fromSemanticResult = (
  result: SemanticRetrievalResult
): HybridRetrievalResult => ({
  channels: ["semantic"],
  contentText: result.contentText,
  conversationId: result.conversationId,
  createdAt: result.createdAt,
  pathId: result.pathId,
  score: Number((result.score + 0.12).toFixed(6)),
  snippet: result.snippet,
  sourceId: result.sourceId,
  sourceType: result.sourceType,
  title: result.title
});

export const getHybridRetrievalCandidates = async ({
  conversationId,
  excludeSources = [],
  limit,
  pathId,
  query,
  userId
}: HybridRetrievalInput) => {
  const [semanticResults, searchResults] = await Promise.all([
    getSemanticRetrievalCandidates({
      conversationId,
      excludeSources,
      limit: limit * 2,
      pathId,
      query,
      userId
    }),
    searchWorkspace({
      conversationId,
      limit: limit * 2,
      pathId,
      query,
      userId
    })
  ]);
  const merged = new Map<string, HybridRetrievalResult>();

  [...semanticResults.map(fromSemanticResult), ...searchResults.map(fromSearchResult)].forEach(
    (result) => {
      const key = toKey(result);
      const existing = merged.get(key);

      if (!existing) {
        merged.set(key, result);
        return;
      }

      merged.set(key, {
        ...existing,
        channels: Array.from(new Set([...existing.channels, ...result.channels])),
        score: Number((existing.score + result.score).toFixed(6)),
        snippet: existing.snippet.length >= result.snippet.length ? existing.snippet : result.snippet
      });
    }
  );

  return Array.from(merged.values())
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
};
