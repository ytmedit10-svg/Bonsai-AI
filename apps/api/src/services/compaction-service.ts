import { and, asc, desc, eq } from "drizzle-orm";

import { loadEnv } from "../config/env.js";
import { db } from "../db/client.js";
import {
  conversations,
  memoryArtifacts,
  messages,
  paths,
  type MemoryArtifact
} from "../db/schema.js";
import { generatePathCompaction, getActiveInferenceProfile } from "./ai-adapter.js";
import { enqueueEmbeddingForSource } from "./embedding-service.js";
import {
  completeModelRun,
  failModelRun,
  startModelRun
} from "./model-run-service.js";

const env = loadEnv();
const APPROX_CHARS_PER_TOKEN = 4;

export const PATH_COMPACTION_ARTIFACT_TYPE = "path_compaction";

type MaybeCompactPathInput = {
  modelName?: string | null;
  pathId: string;
  reason: "after_assistant_response" | "manual";
  thinkingEnabled?: boolean;
  userId: string;
};

type CompactionMetadata = {
  coveredMessageEndSequenceNo?: unknown;
  coveredMessageStartSequenceNo?: unknown;
  sourceMessageIds?: unknown;
  summaryVersion?: unknown;
};

const estimateTokenCount = (value: string) =>
  Math.max(1, Math.ceil(value.length / APPROX_CHARS_PER_TOKEN));

const getPathForCompaction = async (pathId: string, userId: string) => {
  return db
    .select({
      conversationId: paths.conversationId,
      pathId: paths.id,
      pathTitle: paths.title
    })
    .from(paths)
    .innerJoin(conversations, eq(paths.conversationId, conversations.id))
    .where(and(eq(paths.id, pathId), eq(conversations.userId, userId)))
    .limit(1)
    .then((rows) => rows[0] ?? null);
};

const getCompactionMetadata = (
  artifact: Pick<MemoryArtifact, "contentJson"> | null | undefined
): CompactionMetadata => {
  if (!artifact?.contentJson || typeof artifact.contentJson !== "object") {
    return {};
  }

  return artifact.contentJson as CompactionMetadata;
};

export const getCompactionCoveredEndSequenceNo = (
  artifact: Pick<MemoryArtifact, "contentJson"> | null | undefined
) => {
  const value = getCompactionMetadata(artifact).coveredMessageEndSequenceNo;

  return typeof value === "number" && Number.isFinite(value) ? value : 0;
};

const getCompactionSummaryVersion = (
  artifact: Pick<MemoryArtifact, "contentJson"> | null | undefined
) => {
  const value = getCompactionMetadata(artifact).summaryVersion;

  return typeof value === "number" && Number.isFinite(value) ? value : 0;
};

export const getLatestPathCompaction = async (pathId: string) => {
  return db.query.memoryArtifacts.findFirst({
    where: and(
      eq(memoryArtifacts.pathId, pathId),
      eq(memoryArtifacts.artifactType, PATH_COMPACTION_ARTIFACT_TYPE),
      eq(memoryArtifacts.isActive, true)
    ),
    orderBy: [desc(memoryArtifacts.createdAt)]
  });
};

const getPathChatMessages = async (pathId: string) => {
  return db.query.messages
    .findMany({
      where: and(eq(messages.pathId, pathId), eq(messages.messageType, "chat")),
      orderBy: [asc(messages.sequenceNo), asc(messages.createdAt)]
    })
    .then((rows) =>
      rows.filter(
        (message) => message.role === "user" || message.role === "assistant"
      )
    );
};

const pickMessagesToCompact = ({
  coveredEndSequenceNo,
  force,
  pathMessages
}: {
  coveredEndSequenceNo: number;
  force: boolean;
  pathMessages: Awaited<ReturnType<typeof getPathChatMessages>>;
}) => {
  const messagesAfterCompaction = pathMessages.filter(
    (message) => message.sequenceNo > coveredEndSequenceNo
  );

  if (!force && messagesAfterCompaction.length <= env.COMPACTION_TRIGGER_MESSAGES) {
    return [];
  }

  const keepRecentCount = Math.min(
    env.COMPACTION_KEEP_RECENT_MESSAGES,
    Math.max(1, pathMessages.length - 1)
  );
  const cutoffIndex = pathMessages.length - keepRecentCount - 1;
  const cutoffMessage = cutoffIndex >= 0 ? pathMessages[cutoffIndex] : null;

  if (!cutoffMessage) {
    return [];
  }

  return pathMessages
    .filter(
      (message) =>
        message.sequenceNo > coveredEndSequenceNo &&
        message.sequenceNo <= cutoffMessage.sequenceNo
    )
    .slice(0, env.COMPACTION_MAX_SOURCE_MESSAGES);
};

export const maybeCompactPath = async ({
  modelName,
  pathId,
  reason,
  thinkingEnabled = false,
  userId
}: MaybeCompactPathInput) => {
  const pathRecord = await getPathForCompaction(pathId, userId);

  if (!pathRecord) {
    return {
      reason: "path_not_found",
      status: "skipped" as const
    };
  }

  const [currentCompaction, pathMessages] = await Promise.all([
    getLatestPathCompaction(pathId),
    getPathChatMessages(pathId)
  ]);
  const coveredEndSequenceNo =
    getCompactionCoveredEndSequenceNo(currentCompaction);
  const sourceMessages = pickMessagesToCompact({
    coveredEndSequenceNo,
    force: reason === "manual",
    pathMessages
  });

  if (sourceMessages.length === 0) {
    return {
      coveredEndSequenceNo,
      messageCount: pathMessages.length,
      reason: reason === "manual" ? "nothing_to_compact" : "below_threshold",
      status: "skipped" as const
    };
  }

  const firstSourceMessage = sourceMessages[0];
  const lastSourceMessage = sourceMessages.at(-1);

  if (!firstSourceMessage || !lastSourceMessage) {
    return {
      coveredEndSequenceNo,
      reason: "empty_source",
      status: "skipped" as const
    };
  }

  const inferenceProfile = getActiveInferenceProfile();
  const run = await startModelRun({
    cacheMode: "none",
    conversationId: pathRecord.conversationId,
    messageId: lastSourceMessage.id,
    modelName: inferenceProfile.mergeModel,
    modelProvider: inferenceProfile.provider,
    pathId,
    requestPayloadJson: {
      coveredEndSequenceNo,
      firstSourceSequenceNo: firstSourceMessage.sequenceNo,
      selectedModelName: modelName ?? null,
      thinkingEnabled,
      previousCompactionId: currentCompaction?.id ?? null,
      reason,
      sourceMessageCount: sourceMessages.length
    },
    runType: "path_compaction"
  });

  try {
    const generated = await generatePathCompaction({
      modelName,
      pathTitle: pathRecord.pathTitle,
      previousCompactionText: currentCompaction?.contentText ?? null,
      sourceMessages,
      thinkingEnabled
    });

    if (!generated.text.trim()) {
      throw new Error("Compaction model returned an empty summary.");
    }

    const summaryVersion = getCompactionSummaryVersion(currentCompaction) + 1;
    const tokenEstimate = estimateTokenCount(generated.text);

    const [storedArtifact] = await db.transaction(async (tx) => {
      await tx
        .update(memoryArtifacts)
        .set({
          isActive: false
        })
        .where(
          and(
            eq(memoryArtifacts.pathId, pathId),
            eq(memoryArtifacts.artifactType, PATH_COMPACTION_ARTIFACT_TYPE),
            eq(memoryArtifacts.isActive, true)
          )
        );

      return tx
        .insert(memoryArtifacts)
        .values({
          artifactType: PATH_COMPACTION_ARTIFACT_TYPE,
          contentJson: {
            coveredMessageEndSequenceNo: lastSourceMessage.sequenceNo,
            coveredMessageStartSequenceNo: firstSourceMessage.sequenceNo,
            previousCompactionId: currentCompaction?.id ?? null,
            reason,
            sourceMessageIds: sourceMessages.map((message) => message.id),
            summaryVersion
          },
          contentText: generated.text,
          conversationId: pathRecord.conversationId,
          originMessageId: lastSourceMessage.id,
          originPathId: pathId,
          pathId,
          tokenEstimate,
          visibility: "path"
        })
        .returning();
    });

    await completeModelRun({
      cacheMode: "none",
      cacheRecordId: null,
      cachedTokens: generated.usage?.cachedTokens ?? null,
      inputTokens: generated.usage?.inputTokens ?? null,
      modelName: generated.modelName,
      modelProvider: generated.modelProvider,
      outputTokens: generated.usage?.outputTokens ?? null,
      responsePayloadJson: {
        artifactId: storedArtifact?.id ?? null,
        coveredMessageEndSequenceNo: lastSourceMessage.sequenceNo,
        coveredMessageStartSequenceNo: firstSourceMessage.sequenceNo,
        sourceMessageCount: sourceMessages.length,
        summaryVersion,
        totalTokens: generated.usage?.totalTokens ?? null
      },
      runId: run.id
    });

    if (storedArtifact) {
      void enqueueEmbeddingForSource({
        sourceId: storedArtifact.id,
        sourceType: "memory_artifact"
      }).catch(() => undefined);
    }

    return {
      artifact: storedArtifact ?? null,
      coveredEndSequenceNo: lastSourceMessage.sequenceNo,
      sourceMessageCount: sourceMessages.length,
      status: "compacted" as const
    };
  } catch (error) {
    await failModelRun({
      errorText:
        error instanceof Error ? error.message : "Path compaction failed.",
      runId: run.id
    });

    return {
      errorText:
        error instanceof Error ? error.message : "Path compaction failed.",
      status: "failed" as const
    };
  }
};
