import { and, asc, desc, eq, gt, inArray, lt } from "drizzle-orm";

import { loadEnv } from "../config/env.js";
import { db } from "../db/client.js";
import {
  conversations,
  memoryArtifacts,
  messages,
  paths,
  type MemoryArtifact,
  type Message,
  type PathSnapshot
} from "../db/schema.js";
import {
  getCompactionCoveredEndSequenceNo,
  getLatestPathCompaction,
  PATH_COMPACTION_ARTIFACT_TYPE
} from "./compaction-service.js";
import {
  getHybridRetrievalCandidates,
  type HybridRetrievalResult
} from "./hybrid-retrieval-service.js";
import { getLatestPathSnapshot } from "./path-service.js";
import { buildContextSourceReferences } from "./source-reference-service.js";

const env = loadEnv();
const APPROX_CHARS_PER_TOKEN = 4;
const MERGE_ARTIFACT_TYPES = ["merge_summary", "merge_full"] as const;

type ContextPurpose = "chat_response" | "regenerate";

type ContextBudgetPolicy = {
  maxEstimatedTokens: number;
  maxMergeMemories: number;
  maxRetrievalCandidates: number;
  recentMessageLimit: number;
};

type ContextDroppedItem = {
  id: string;
  kind: "message" | "merge_memory" | "retrieval_candidate";
  reason: string;
  score?: number;
  sourceType?: string;
  tokenEstimate: number;
};

type ContextCacheCandidate = {
  id: string;
  kind: "branch_snapshot" | "path_compaction";
  tokenEstimate: number;
};

type ContextMemoryItem = {
  id: string;
  kind: "branch_snapshot" | "merge_memory" | "path_compaction" | "retrieval_candidate";
  tokenEstimate: number;
};

export type ContextBundle = {
  activeCompaction: MemoryArtifact | null;
  branchSnapshot: PathSnapshot | null;
  cacheCandidates: ContextCacheCandidate[];
  droppedItems: ContextDroppedItem[];
  estimatedTokens: number;
  memoryContextText: string | null;
  mergeMemories: MemoryArtifact[];
  path: NonNullable<Awaited<ReturnType<typeof getPathForContext>>>;
  policy: ContextBudgetPolicy;
  purpose: ContextPurpose;
  recentMessages: Message[];
  retrievalCandidates: HybridRetrievalResult[];
  sourceUserMessage: Message | null;
  targetAssistantMessage: Message | null;
};

type BuildContextBundleInput = {
  beforeAssistantMessageId?: string;
  pathId: string;
  purpose: ContextPurpose;
  userId: string;
};

const estimateTokenCount = (value: string | null | undefined) => {
  if (!value?.trim()) {
    return 0;
  }

  return Math.max(1, Math.ceil(value.length / APPROX_CHARS_PER_TOKEN));
};

const estimateMessageTokens = (message: Message) =>
  estimateTokenCount(message.contentText);

const estimateArtifactTokens = (artifact: MemoryArtifact) =>
  artifact.tokenEstimate ?? estimateTokenCount(artifact.contentText);

const estimateRetrievalTokens = (candidate: HybridRetrievalResult) =>
  estimateTokenCount(candidate.contentText);

const getPathForContext = async (pathId: string, userId: string) => {
  return db
    .select({
      conversationId: paths.conversationId,
      depth: paths.depth,
      isMain: paths.isMain,
      parentPathId: paths.parentPathId,
      pathId: paths.id,
      pathTitle: paths.title,
      splitBlockEndOffset: paths.splitBlockEndOffset,
      splitBlockStartOffset: paths.splitBlockStartOffset,
      splitBlockType: paths.splitBlockType,
      splitFocusText: paths.splitFocusText,
      splitFromMessageId: paths.splitFromMessageId
    })
    .from(paths)
    .innerJoin(conversations, eq(paths.conversationId, conversations.id))
    .where(and(eq(paths.id, pathId), eq(conversations.userId, userId)))
    .limit(1)
    .then((rows) => rows[0] ?? null);
};

const buildMemoryContextText = ({
  activeCompaction,
  mergeMemories,
  retrievalCandidates
}: {
  activeCompaction: MemoryArtifact | null;
  mergeMemories: MemoryArtifact[];
  retrievalCandidates: HybridRetrievalResult[];
}) => {
  const sections: string[] = [];

  if (activeCompaction?.contentText.trim()) {
    sections.push(
      [
        "Path compaction memory:",
        activeCompaction.contentText.trim()
      ].join("\n\n")
    );
  }

  mergeMemories.forEach((artifact, index) => {
    if (!artifact.contentText.trim()) {
      return;
    }

    sections.push(
      [
        `Merge memory ${index + 1}:`,
        artifact.contentText.trim()
      ].join("\n\n")
    );
  });

  retrievalCandidates.forEach((candidate, index) => {
    if (!candidate.contentText.trim()) {
      return;
    }

    sections.push(
      [
        `Retrieved context ${index + 1} (${candidate.channels.join("+")}): ${candidate.title}`,
        candidate.contentText.trim()
      ].join("\n\n")
    );
  });

  return sections.length > 0 ? sections.join("\n\n---\n\n") : null;
};

const buildContextItems = ({
  activeCompaction,
  branchSnapshot,
  mergeMemories,
  retrievalCandidates
}: {
  activeCompaction: MemoryArtifact | null;
  branchSnapshot: PathSnapshot | null;
  mergeMemories: MemoryArtifact[];
  retrievalCandidates: HybridRetrievalResult[];
}): ContextMemoryItem[] => [
  ...(branchSnapshot
    ? [
        {
          id: branchSnapshot.id,
          kind: "branch_snapshot" as const,
          tokenEstimate: estimateTokenCount(branchSnapshot.snapshotText)
        }
      ]
    : []),
  ...(activeCompaction
    ? [
        {
          id: activeCompaction.id,
          kind: "path_compaction" as const,
          tokenEstimate: estimateArtifactTokens(activeCompaction)
        }
      ]
    : []),
  ...mergeMemories.map((artifact) => ({
    id: artifact.id,
    kind: "merge_memory" as const,
    tokenEstimate: estimateArtifactTokens(artifact)
  })),
  ...retrievalCandidates.map((candidate) => ({
    id: candidate.sourceId,
    kind: "retrieval_candidate" as const,
    tokenEstimate: estimateTokenCount(candidate.contentText)
  }))
];

const trimToBudget = ({
  branchSnapshot,
  droppedItems,
  fixedMemoryContextText,
  policy,
  recentMessages,
  retrievalCandidates
}: {
  branchSnapshot: PathSnapshot | null;
  droppedItems: ContextDroppedItem[];
  fixedMemoryContextText: string | null;
  policy: ContextBudgetPolicy;
  recentMessages: Message[];
  retrievalCandidates: HybridRetrievalResult[];
}) => {
  let selectedMessages = [...recentMessages];
  let selectedRetrievalCandidates = [...retrievalCandidates];
  let estimatedTokens =
    estimateTokenCount(branchSnapshot?.snapshotText) +
    estimateTokenCount(fixedMemoryContextText) +
    selectedRetrievalCandidates.reduce(
      (total, candidate) => total + estimateRetrievalTokens(candidate),
      0
    ) +
    selectedMessages.reduce(
      (total, message) => total + estimateMessageTokens(message),
      0
    );

  while (
    estimatedTokens > policy.maxEstimatedTokens &&
    selectedRetrievalCandidates.length > 0
  ) {
    const dropped = selectedRetrievalCandidates.pop();

    if (!dropped) {
      break;
    }

    const tokenEstimate = estimateRetrievalTokens(dropped);
    estimatedTokens -= tokenEstimate;
    droppedItems.push({
      id: dropped.sourceId,
      kind: "retrieval_candidate",
      reason: "context_budget_exceeded",
      score: dropped.score,
      sourceType: dropped.sourceType,
      tokenEstimate
    });
  }

  while (
    estimatedTokens > policy.maxEstimatedTokens &&
    selectedMessages.length > 1
  ) {
    const dropped = selectedMessages.shift();

    if (!dropped) {
      break;
    }

    const tokenEstimate = estimateMessageTokens(dropped);
    estimatedTokens -= tokenEstimate;
    droppedItems.push({
      id: dropped.id,
      kind: "message",
      reason: "context_budget_exceeded",
      tokenEstimate
    });
  }

  return {
    estimatedTokens,
    recentMessages: selectedMessages,
    retrievalCandidates: selectedRetrievalCandidates
  };
};

const dedupeRetrievalCandidates = ({
  candidates,
  excludedSources
}: {
  candidates: HybridRetrievalResult[];
  excludedSources: Array<{
    sourceId: string;
    sourceType?: string;
  }>;
}) => {
  const excluded = new Set(
    excludedSources.map((source) =>
      source.sourceType ? `${source.sourceType}:${source.sourceId}` : source.sourceId
    )
  );
  const seen = new Set<string>();
  const deduped: HybridRetrievalResult[] = [];

  for (const candidate of [...candidates].sort((left, right) => right.score - left.score)) {
    const key = `${candidate.sourceType}:${candidate.sourceId}`;

    if (seen.has(key) || excluded.has(key) || excluded.has(candidate.sourceId)) {
      continue;
    }

    seen.add(key);
    deduped.push(candidate);
  }

  return deduped;
};

export const summarizeContextBundle = (bundle: ContextBundle) => ({
  cacheCandidates: bundle.cacheCandidates,
  compactionArtifactId: bundle.activeCompaction?.id ?? null,
  compactionCoveredEndSequenceNo:
    getCompactionCoveredEndSequenceNo(bundle.activeCompaction) || null,
  droppedItems: bundle.droppedItems,
  estimatedTokens: bundle.estimatedTokens,
  memories: buildContextItems({
    activeCompaction: bundle.activeCompaction,
    branchSnapshot: bundle.branchSnapshot,
    mergeMemories: bundle.mergeMemories,
    retrievalCandidates: bundle.retrievalCandidates
  }),
  mergeMemoryCount: bundle.mergeMemories.length,
  pathId: bundle.path.pathId,
  purpose: bundle.purpose,
  recentMessages: bundle.recentMessages.length,
  retrievalCandidates: bundle.retrievalCandidates.map((candidate) => ({
    channels: candidate.channels,
    pathId: candidate.pathId,
    score: candidate.score,
    sourceId: candidate.sourceId,
    sourceType: candidate.sourceType,
    title: candidate.title
  })),
  sources: buildContextSourceReferences(bundle),
  snapshotId: bundle.branchSnapshot?.id ?? null
});

export const buildContextBundle = async ({
  beforeAssistantMessageId,
  pathId,
  purpose,
  userId
}: BuildContextBundleInput): Promise<ContextBundle | null> => {
  const pathRecord = await getPathForContext(pathId, userId);

  if (!pathRecord) {
    return null;
  }

  const targetAssistantMessage = beforeAssistantMessageId
    ? await db.query.messages.findFirst({
        where: and(
          eq(messages.id, beforeAssistantMessageId),
          eq(messages.pathId, pathId),
          eq(messages.role, "assistant")
        )
      })
    : null;

  if (beforeAssistantMessageId && !targetAssistantMessage) {
    return null;
  }

  const [rawCompaction, branchSnapshot, mergeMemories] = await Promise.all([
    getLatestPathCompaction(pathId),
    getLatestPathSnapshot(pathId),
    db.query.memoryArtifacts.findMany({
      where: and(
        eq(memoryArtifacts.pathId, pathId),
        inArray(memoryArtifacts.artifactType, [...MERGE_ARTIFACT_TYPES])
      ),
      orderBy: [desc(memoryArtifacts.createdAt)],
      limit: env.CONTEXT_MAX_MERGE_MEMORIES + 1
    })
  ]);
  const selectedMergeMemories = mergeMemories.slice(
    0,
    env.CONTEXT_MAX_MERGE_MEMORIES
  );
  const droppedMergeMemories = mergeMemories.slice(env.CONTEXT_MAX_MERGE_MEMORIES);

  const coveredEndSequenceNo = getCompactionCoveredEndSequenceNo(rawCompaction);
  const activeCompaction =
    rawCompaction &&
    (!targetAssistantMessage ||
      (coveredEndSequenceNo > 0 &&
        coveredEndSequenceNo < targetAssistantMessage.sequenceNo))
      ? rawCompaction
      : null;
  const lowerSequenceNo = getCompactionCoveredEndSequenceNo(activeCompaction);
  const messageWhere = targetAssistantMessage
    ? lowerSequenceNo > 0
      ? and(
          eq(messages.pathId, pathId),
          gt(messages.sequenceNo, lowerSequenceNo),
          lt(messages.sequenceNo, targetAssistantMessage.sequenceNo)
        )
      : and(
          eq(messages.pathId, pathId),
          lt(messages.sequenceNo, targetAssistantMessage.sequenceNo)
        )
    : lowerSequenceNo > 0
      ? and(eq(messages.pathId, pathId), gt(messages.sequenceNo, lowerSequenceNo))
      : eq(messages.pathId, pathId);

  const recentMessages = await db.query.messages.findMany({
    where: messageWhere,
    orderBy: [desc(messages.sequenceNo), desc(messages.createdAt)],
    limit: env.MAX_RECENT_MESSAGES_PER_PATH
  });
  recentMessages.reverse();

  const sourceUserMessage =
    purpose === "regenerate"
      ? [...recentMessages].reverse().find((message) => message.role === "user") ??
        null
      : null;
  const retrievalQueryMessage =
    sourceUserMessage ??
    [...recentMessages].reverse().find((message) => message.role === "user") ??
    null;

  if (purpose === "regenerate" && !sourceUserMessage) {
    return null;
  }

  const policy = {
    maxEstimatedTokens: env.CONTEXT_MAX_ESTIMATED_TOKENS,
    maxMergeMemories: env.CONTEXT_MAX_MERGE_MEMORIES,
    maxRetrievalCandidates: env.CONTEXT_MAX_RETRIEVAL_CANDIDATES,
    recentMessageLimit: env.MAX_RECENT_MESSAGES_PER_PATH
  };
  const droppedItems: ContextDroppedItem[] = [];
  droppedMergeMemories.forEach((artifact) => {
    droppedItems.push({
      id: artifact.id,
      kind: "merge_memory",
      reason: "merge_memory_limit_exceeded",
      tokenEstimate: estimateArtifactTokens(artifact)
    });
  });
  const excludedRetrievalSources = [
    ...recentMessages.map((message) => ({
      sourceId: message.id,
      sourceType: "message"
    })),
    ...(branchSnapshot
      ? [
          {
            sourceId: branchSnapshot.id,
            sourceType: "path_snapshot"
          }
        ]
      : []),
    ...(activeCompaction
      ? [
          {
            sourceId: activeCompaction.id,
            sourceType: "memory_artifact"
          }
        ]
      : []),
    ...selectedMergeMemories.map((artifact) => ({
      sourceId: artifact.id,
      sourceType: artifact.artifactType.startsWith("merge_")
        ? "merge_artifact"
        : "memory_artifact"
    }))
  ];
  const rawRetrievalCandidates = retrievalQueryMessage
    ? await getHybridRetrievalCandidates({
        conversationId: pathRecord.conversationId,
        excludeSources: excludedRetrievalSources,
        limit: env.CONTEXT_MAX_RETRIEVAL_CANDIDATES * 2,
        pathId,
        query: retrievalQueryMessage.contentText,
        userId
      })
    : [];
  const rankedRetrievalCandidates = dedupeRetrievalCandidates({
    candidates: rawRetrievalCandidates,
    excludedSources: excludedRetrievalSources
  });
  const retrievalCandidates = rankedRetrievalCandidates.slice(
    0,
    env.CONTEXT_MAX_RETRIEVAL_CANDIDATES
  );
  rankedRetrievalCandidates
    .slice(env.CONTEXT_MAX_RETRIEVAL_CANDIDATES)
    .forEach((candidate) => {
      droppedItems.push({
        id: candidate.sourceId,
        kind: "retrieval_candidate",
        reason: "retrieval_candidate_limit_exceeded",
        score: candidate.score,
        sourceType: candidate.sourceType,
        tokenEstimate: estimateRetrievalTokens(candidate)
      });
    });
  const fixedMemoryContextText = buildMemoryContextText({
    activeCompaction,
    mergeMemories: selectedMergeMemories,
    retrievalCandidates: []
  });
  const trimmed = trimToBudget({
    branchSnapshot: branchSnapshot ?? null,
    droppedItems,
    fixedMemoryContextText,
    policy,
    recentMessages,
    retrievalCandidates
  });
  const memoryContextText = buildMemoryContextText({
    activeCompaction,
    mergeMemories: selectedMergeMemories,
    retrievalCandidates: trimmed.retrievalCandidates
  });

  const normalizedBranchSnapshot = branchSnapshot ?? null;
  const cacheCandidates: ContextCacheCandidate[] = [
    ...(normalizedBranchSnapshot
      ? [
          {
            id: normalizedBranchSnapshot.id,
            kind: "branch_snapshot" as const,
            tokenEstimate: estimateTokenCount(normalizedBranchSnapshot.snapshotText)
          }
        ]
      : []),
    ...(activeCompaction
      ? [
          {
            id: activeCompaction.id,
            kind: "path_compaction" as const,
            tokenEstimate: estimateArtifactTokens(activeCompaction)
          }
        ]
      : [])
  ];

  return {
    activeCompaction,
    branchSnapshot: normalizedBranchSnapshot,
    cacheCandidates,
    droppedItems,
    estimatedTokens: trimmed.estimatedTokens,
    memoryContextText,
    mergeMemories: selectedMergeMemories,
    path: pathRecord,
    policy,
    purpose,
    recentMessages: trimmed.recentMessages,
    retrievalCandidates: trimmed.retrievalCandidates,
    sourceUserMessage,
    targetAssistantMessage: targetAssistantMessage ?? null
  };
};
