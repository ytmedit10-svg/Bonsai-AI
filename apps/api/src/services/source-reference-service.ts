import type { SourceReference } from "@node-based-chat/shared";

import type { ContextBundle } from "./context-budget-service.js";

const SNIPPET_LIMIT = 220;

const toSnippet = (value: string | null | undefined) => {
  const normalized = value?.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return null;
  }

  return normalized.length > SNIPPET_LIMIT
    ? `${normalized.slice(0, SNIPPET_LIMIT - 3).trimEnd()}...`
    : normalized;
};

export const buildContextSourceReferences = (
  bundle: ContextBundle
): SourceReference[] => {
  const sources: SourceReference[] = [];

  if (bundle.branchSnapshot) {
    sources.push({
      conversationId: bundle.path.conversationId,
      label: "Branch snapshot",
      metadata: {
        sourceMessageId: bundle.branchSnapshot.sourceMessageId,
        sourcePathId: bundle.branchSnapshot.sourcePathId,
        versionNo: bundle.branchSnapshot.versionNo
      },
      pathId: bundle.branchSnapshot.pathId,
      snippet: toSnippet(bundle.branchSnapshot.snapshotText),
      sourceId: bundle.branchSnapshot.id,
      sourceType: "branch_snapshot"
    });
  }

  if (bundle.activeCompaction) {
    sources.push({
      conversationId: bundle.activeCompaction.conversationId,
      label: "Compacted memory",
      metadata: {
        originMessageId: bundle.activeCompaction.originMessageId,
        originPathId: bundle.activeCompaction.originPathId,
        tokenEstimate: bundle.activeCompaction.tokenEstimate
      },
      pathId: bundle.activeCompaction.pathId,
      snippet: toSnippet(bundle.activeCompaction.contentText),
      sourceId: bundle.activeCompaction.id,
      sourceType: "compacted_memory"
    });
  }

  bundle.mergeMemories.forEach((artifact, index) => {
    sources.push({
      conversationId: artifact.conversationId,
      label: `Merge memory ${index + 1}`,
      metadata: {
        artifactType: artifact.artifactType,
        originMergeId: artifact.originMergeId,
        originPathId: artifact.originPathId,
        tokenEstimate: artifact.tokenEstimate
      },
      pathId: artifact.pathId,
      snippet: toSnippet(artifact.contentText),
      sourceId: artifact.id,
      sourceType: "merge_memory"
    });
  });

  bundle.retrievalCandidates.forEach((candidate, index) => {
    sources.push({
      conversationId: candidate.conversationId,
      label: `Retrieved context ${index + 1}`,
      metadata: {
        channels: candidate.channels,
        score: candidate.score,
        sourceType: candidate.sourceType,
        title: candidate.title
      },
      pathId: candidate.pathId,
      snippet: toSnippet(candidate.snippet),
      sourceId: candidate.sourceId,
      sourceType: "retrieval_result"
    });
  });

  bundle.recentMessages.forEach((message) => {
    sources.push({
      conversationId: message.conversationId,
      label: `${message.role} message #${message.sequenceNo}`,
      metadata: {
        messageType: message.messageType,
        role: message.role,
        sequenceNo: message.sequenceNo,
        status: message.status
      },
      pathId: message.pathId,
      snippet: toSnippet(message.contentText),
      sourceId: message.id,
      sourceType: "message"
    });
  });

  return sources;
};

export const buildAssistantContentSources = (bundle: ContextBundle) => ({
  sources: buildContextSourceReferences(bundle)
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const getString = (value: Record<string, unknown>, key: string) => {
  const item = value[key];
  return typeof item === "string" && item.trim() ? item.trim() : null;
};

export const buildWebGroundingSourceReferences = ({
  conversationId,
  groundingMetadata,
  pathId
}: {
  conversationId: string;
  groundingMetadata: unknown;
  pathId: string;
}): SourceReference[] => {
  if (!isRecord(groundingMetadata) || !Array.isArray(groundingMetadata.groundingChunks)) {
    return [];
  }

  const seen = new Set<string>();
  const sources: SourceReference[] = [];

  groundingMetadata.groundingChunks.forEach((chunk, index) => {
    if (!isRecord(chunk) || !isRecord(chunk.web)) {
      return;
    }

    const uri = getString(chunk.web, "uri");

    if (!uri || seen.has(uri)) {
      return;
    }

    seen.add(uri);

    const title = getString(chunk.web, "title") ?? `Web source ${sources.length + 1}`;

    sources.push({
      conversationId,
      label: title,
      metadata: {
        groundingChunkIndex: index,
        source: "google_search",
        title,
        uri
      },
      pathId,
      snippet: uri,
      sourceId: uri,
      sourceType: "search_result"
    });
  });

  return sources;
};

export const buildAssistantWebSourceContent = ({
  conversationId,
  groundingMetadata,
  pathId
}: {
  conversationId: string;
  groundingMetadata: unknown;
  pathId: string;
}) => ({
  sources: buildWebGroundingSourceReferences({
    conversationId,
    groundingMetadata,
    pathId
  })
});

export const buildAssistantContentSourcesWithWeb = ({
  bundle,
  groundingMetadata
}: {
  bundle: ContextBundle;
  groundingMetadata: unknown;
}) => ({
  sources: [
    ...buildContextSourceReferences(bundle),
    ...buildWebGroundingSourceReferences({
      conversationId: bundle.path.conversationId,
      groundingMetadata,
      pathId: bundle.path.pathId
    })
  ]
});
