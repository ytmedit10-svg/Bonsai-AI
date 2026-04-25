import { and, asc, desc, eq, gt } from "drizzle-orm";

import { db } from "../db/client.js";
import {
  conversations,
  memoryArtifacts,
  merges,
  messages,
  paths
} from "../db/schema.js";
import {
  getActiveInferenceProfile,
  MissingAiProviderApiKeyError,
  generateMergeArtifact
} from "./ai-adapter.js";
import {
  completeModelRun,
  failModelRun,
  startModelRun
} from "./model-run-service.js";
import { createMergeMemoryMessage } from "./message-service.js";
import { getLatestPathSnapshot } from "./path-service.js";

type MergeMode = "light" | "full" | "reference" | "collapse";

type RequestMergeInput = {
  acknowledgeOutdated?: boolean;
  mergeMode: MergeMode;
  sourcePathId: string;
  targetPathId?: string | null;
  userId: string;
};

const hasMainMovedForward = async ({
  sourcePath,
  targetPathId
}: {
  sourcePath: {
    createdAt: Date;
    id: string;
    parentPathId: string | null;
    splitFromMessageId: string | null;
  };
  targetPathId: string;
}) => {
  if (sourcePath.parentPathId === targetPathId && sourcePath.splitFromMessageId) {
    const splitMessage = await db.query.messages.findFirst({
      columns: {
        sequenceNo: true
      },
      where: and(
        eq(messages.id, sourcePath.splitFromMessageId),
        eq(messages.pathId, targetPathId)
      )
    });

    if (splitMessage) {
      const newerMessage = await db.query.messages.findFirst({
        columns: {
          id: true
        },
        where: and(
          eq(messages.pathId, targetPathId),
          gt(messages.sequenceNo, splitMessage.sequenceNo)
        )
      });

      return Boolean(newerMessage);
    }
  }

  const newerMessage = await db.query.messages.findFirst({
    columns: {
      id: true
    },
    where: and(
      eq(messages.pathId, targetPathId),
      gt(messages.createdAt, sourcePath.createdAt)
    )
  });

  return Boolean(newerMessage);
};

const buildMergeSummary = (
  merge: {
    completedAt: Date | null;
    createdAt: Date;
    errorText: string | null;
    id: string;
    mergeMode: string;
    resultArtifactId: string | null;
    resultMessageId: string | null;
    sourcePathId: string;
    status: string;
    targetPathId: string;
  },
  sourcePath: {
    id: string;
    title: string;
  } | null,
  targetPath: {
    id: string;
    title: string;
  } | null
) => ({
  completedAt: merge.completedAt,
  createdAt: merge.createdAt,
  errorText: merge.errorText,
  id: merge.id,
  mergeMode: merge.mergeMode,
  resultArtifactId: merge.resultArtifactId,
  resultMessageId: merge.resultMessageId,
  sourcePath: sourcePath
    ? {
        id: sourcePath.id,
        title: sourcePath.title
      }
    : null,
  sourcePathId: merge.sourcePathId,
  status: merge.status,
  targetPath: targetPath
    ? {
        id: targetPath.id,
        title: targetPath.title
      }
    : null,
  targetPathId: merge.targetPathId
});

const buildMainMemoryMessage = ({
  artifactText,
  mergeMode,
  sourcePathTitle
}: {
  artifactText: string;
  mergeMode: MergeMode;
  sourcePathTitle: string;
}) => {
  return [
    `Merged memory from branch "${sourcePathTitle}" into main (${mergeMode} mode).`,
    "",
    artifactText
  ].join("\n");
};

const getArtifactType = (mergeMode: MergeMode) =>
  mergeMode === "full" ? "merge_full" : "merge_summary";

export const requestMerge = async ({
  acknowledgeOutdated = false,
  mergeMode,
  sourcePathId,
  targetPathId,
  userId
}: RequestMergeInput) => {
  const sourcePath = await db
    .select({
      conversationId: paths.conversationId,
      createdAt: paths.createdAt,
      id: paths.id,
      isMain: paths.isMain,
      parentPathId: paths.parentPathId,
      splitFromMessageId: paths.splitFromMessageId,
      title: paths.title
    })
    .from(paths)
    .innerJoin(conversations, eq(paths.conversationId, conversations.id))
    .where(and(eq(paths.id, sourcePathId), eq(conversations.userId, userId)))
    .limit(1)
    .then((rows) => rows[0] ?? null);

  if (!sourcePath) {
    return null;
  }

  if (sourcePath.isMain) {
    return {
      error: "Select a non-main branch as the merge source."
    } as const;
  }

  const conversation = await db.query.conversations.findFirst({
    where: and(
      eq(conversations.id, sourcePath.conversationId),
      eq(conversations.userId, userId)
    )
  });

  if (!conversation?.mainPathId) {
    return {
      error: "Main path not found for this conversation."
    } as const;
  }

  const resolvedTargetPathId = targetPathId ?? conversation.mainPathId;

  const targetPath = await db.query.paths.findFirst({
    columns: {
      conversationId: true,
      id: true,
      isMain: true,
      title: true
    },
    where: and(
      eq(paths.id, resolvedTargetPathId),
      eq(paths.conversationId, sourcePath.conversationId)
    )
  });

  if (!targetPath) {
    return {
      error: "Target path not found in this conversation."
    } as const;
  }

  if (!targetPath.isMain) {
    return {
      error: "MVP merge flow only supports merging into the main path."
    } as const;
  }

  if (!acknowledgeOutdated) {
    const mainMovedForward = await hasMainMovedForward({
      sourcePath,
      targetPathId: targetPath.id
    });

    if (mainMovedForward) {
      return {
        reason: "main_moved_forward",
        requiresConfirmation: true,
        sourcePath: {
          id: sourcePath.id,
          title: sourcePath.title
        },
        targetPath: {
          id: targetPath.id,
          title: targetPath.title
        }
      } as const;
    }
  }

  const [createdMerge] = await db
    .insert(merges)
    .values({
      conversationId: sourcePath.conversationId,
      mergeMode,
      requestedByUserId: userId,
      sourcePathId: sourcePath.id,
      status: "pending",
      targetPathId: targetPath.id
    })
    .returning();

  let mergeRunId: string | null = null;

  try {
    const [sourceMessages, targetMessages, snapshot] = await Promise.all([
      db.query.messages.findMany({
        where: eq(messages.pathId, sourcePath.id),
        orderBy: [asc(messages.sequenceNo), asc(messages.createdAt)]
      }),
      db.query.messages.findMany({
        where: eq(messages.pathId, targetPath.id),
        orderBy: [desc(messages.sequenceNo), desc(messages.createdAt)],
        limit: 8
      }).then((rows) => rows.reverse()),
      getLatestPathSnapshot(sourcePath.id)
    ]);

    const inferenceProfile = getActiveInferenceProfile();
    const mergeRun = await startModelRun({
      cacheMode: "none",
      conversationId: sourcePath.conversationId,
      mergeId: createdMerge.id,
      modelName: inferenceProfile.mergeModel,
      modelProvider: inferenceProfile.provider,
      pathId: sourcePath.id,
      requestPayloadJson: {
        hasSnapshot: Boolean(snapshot?.snapshotText),
        mergeMode,
        sourceMessageCount: sourceMessages.length,
        targetMessageWindow: targetMessages.length
      },
      runType: "merge_generation"
    });
    mergeRunId = mergeRun.id;

    const generated = await generateMergeArtifact({
      mergeMode,
      inheritedSnapshotText: snapshot?.snapshotText ?? null,
      sourceMessages,
      sourcePathTitle: sourcePath.title,
      targetMessages,
      targetPathTitle: targetPath.title
    });

    await completeModelRun({
      cacheMode: "none",
      cachedTokens: generated.usage?.cachedTokens ?? null,
      inputTokens: generated.usage?.inputTokens ?? null,
      modelName: generated.modelName,
      modelProvider: generated.modelProvider,
      outputTokens: generated.usage?.outputTokens ?? null,
      responsePayloadJson: {
        totalTokens: generated.usage?.totalTokens ?? null
      },
      runId: mergeRunId
    });

    const [storedArtifact] = await db
      .insert(memoryArtifacts)
      .values({
        artifactType: getArtifactType(mergeMode),
        contentJson: {
          mergeId: createdMerge.id,
          mergeMode,
          sourcePathId: sourcePath.id,
          sourcePathTitle: sourcePath.title,
          targetPathId: targetPath.id,
          targetPathTitle: targetPath.title
        },
        contentText: generated.text,
        conversationId: sourcePath.conversationId,
        originMergeId: createdMerge.id,
        originPathId: sourcePath.id,
        pathId: targetPath.id,
        visibility: "conversation"
      })
      .returning();

    const mergeMemoryMessage = await createMergeMemoryMessage({
      artifactId: storedArtifact.id,
      content: buildMainMemoryMessage({
        artifactText: generated.text,
        mergeMode,
        sourcePathTitle: sourcePath.title
      }),
      mergeId: createdMerge.id,
      mergeMode,
      modelName: generated.modelName,
      modelProvider: generated.modelProvider,
      pathId: targetPath.id,
      sourcePathId: sourcePath.id,
      sourcePathTitle: sourcePath.title,
      userId
    });

    const [completedMerge] = await db
      .update(merges)
      .set({
        completedAt: new Date(),
        errorText: null,
        resultArtifactId: storedArtifact.id,
        resultMessageId: mergeMemoryMessage?.message.id ?? null,
        status: "completed"
      })
      .where(eq(merges.id, createdMerge.id))
      .returning();

    await db
      .update(conversations)
      .set({
        updatedAt: new Date()
      })
      .where(eq(conversations.id, sourcePath.conversationId));

    return {
      artifact: storedArtifact,
      mainMessage: mergeMemoryMessage?.message ?? null,
      merge: completedMerge,
      sourcePath: {
        id: sourcePath.id,
        title: sourcePath.title
      },
      targetPath: {
        id: targetPath.id,
        title: targetPath.title
      }
    };
  } catch (error) {
    if (error instanceof MissingAiProviderApiKeyError) {
      if (mergeRunId) {
        await failModelRun({
          errorText: error.message,
          runId: mergeRunId
        });
      }
      throw error;
    }

    if (mergeRunId) {
      await failModelRun({
        errorText:
          error instanceof Error ? error.message : "Failed to generate merge artifact.",
        runId: mergeRunId
      });
    }

    const errorText =
      error instanceof Error ? error.message : "Failed to generate merge artifact.";

    const [failedMerge] = await db
      .update(merges)
      .set({
        completedAt: new Date(),
        errorText,
        status: "failed"
      })
      .where(eq(merges.id, createdMerge.id))
      .returning();

    return {
      error: errorText,
      merge: failedMerge,
      sourcePath: {
        id: sourcePath.id,
        title: sourcePath.title
      },
      targetPath: {
        id: targetPath.id,
        title: targetPath.title
      }
    } as const;
  }
};

export const getMergeById = async (mergeId: string, userId: string) => {
  const merge = await db
    .select({
      completedAt: merges.completedAt,
      conversationId: merges.conversationId,
      createdAt: merges.createdAt,
      errorText: merges.errorText,
      id: merges.id,
      mergeMode: merges.mergeMode,
      resultArtifactId: merges.resultArtifactId,
      resultMessageId: merges.resultMessageId,
      sourcePathId: merges.sourcePathId,
      status: merges.status,
      targetPathId: merges.targetPathId
    })
    .from(merges)
    .innerJoin(conversations, eq(merges.conversationId, conversations.id))
    .where(and(eq(merges.id, mergeId), eq(conversations.userId, userId)))
    .limit(1)
    .then((rows) => rows[0] ?? null);

  if (!merge) {
    return null;
  }

  const [artifact, mainMessage, sourcePath, targetPath] = await Promise.all([
    merge.resultArtifactId
      ? db.query.memoryArtifacts.findFirst({
          where: eq(memoryArtifacts.id, merge.resultArtifactId)
        })
      : null,
    merge.resultMessageId
      ? db.query.messages.findFirst({
          where: eq(messages.id, merge.resultMessageId)
        })
      : null,
    db.query.paths.findFirst({
      columns: {
        id: true,
        title: true
      },
      where: eq(paths.id, merge.sourcePathId)
    }),
    db.query.paths.findFirst({
      columns: {
        id: true,
        title: true
      },
      where: eq(paths.id, merge.targetPathId)
    })
  ]);

  return {
    artifact: artifact ?? null,
    mainMessage: mainMessage ?? null,
    merge: buildMergeSummary(merge, sourcePath ?? null, targetPath ?? null),
    sourcePath: sourcePath ?? null,
    targetPath: targetPath ?? null
  };
};

export const listConversationMerges = async (
  conversationId: string,
  userId: string
) => {
  const conversation = await db.query.conversations.findFirst({
    where: and(
      eq(conversations.id, conversationId),
      eq(conversations.userId, userId)
    )
  });

  if (!conversation) {
    return null;
  }

  const mergeRows = await db.query.merges.findMany({
    where: eq(merges.conversationId, conversationId),
    orderBy: [desc(merges.createdAt)]
  });

  const sourcePathIds = [...new Set(mergeRows.map((merge) => merge.sourcePathId))];
  const targetPathIds = [...new Set(mergeRows.map((merge) => merge.targetPathId))];
  const artifactIds = [
    ...new Set(
      mergeRows
        .map((merge) => merge.resultArtifactId)
        .filter((artifactId): artifactId is string => Boolean(artifactId))
    )
  ];

  const [pathRows, artifactRows] = await Promise.all([
    db.query.paths.findMany({
      columns: {
        id: true,
        title: true
      },
      where:
        sourcePathIds.length + targetPathIds.length > 0
          ? undefined
          : eq(paths.conversationId, conversationId)
    }),
    artifactIds.length === 0
      ? Promise.resolve([])
      : db.query.memoryArtifacts.findMany({
          where: eq(memoryArtifacts.conversationId, conversationId),
          orderBy: [desc(memoryArtifacts.createdAt)]
        })
  ]);

  const relevantPathIds = new Set([...sourcePathIds, ...targetPathIds]);
  const pathMap = new Map(
    pathRows
      .filter((path) => relevantPathIds.has(path.id))
      .map((path) => [path.id, path] as const)
  );
  const artifactMap = new Map(
    artifactRows
      .filter((artifact) => artifactIds.includes(artifact.id))
      .map((artifact) => [artifact.id, artifact] as const)
  );

  return {
    conversation,
    merges: mergeRows.map((merge) => ({
      artifact: merge.resultArtifactId
        ? artifactMap.get(merge.resultArtifactId) ?? null
        : null,
      merge: buildMergeSummary(
        merge,
        pathMap.get(merge.sourcePathId) ?? null,
        pathMap.get(merge.targetPathId) ?? null
      )
    }))
  };
};
