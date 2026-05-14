import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import {
  createAssistantMessage,
  createPathMessage,
  listPathMessages,
  MessageEditRegenerationError,
  selectPathAssistantMessageVariant,
  updatePathAssistantMessage,
  updateLatestUserMessageForRegeneration,
  updatePathUserMessage
} from "../services/message-service.js";
import { ensureRequestUser } from "../services/bootstrap-user-service.js";
import {
  AiProviderCapabilityError,
  getActiveInferenceProfile,
  MissingAiProviderApiKeyError,
  generatePathReply,
  streamPathReply
} from "../services/ai-adapter.js";
import {
  completeModelRun,
  failModelRun,
  startModelRun
} from "../services/model-run-service.js";
import { attachUploadedAttachmentsToMessage } from "../services/attachment-service.js";
import {
  buildContextBundle,
  summarizeContextBundle
} from "../services/context-budget-service.js";
import {
  buildApiError,
  buildProviderApiError,
  getProviderStatusCode,
  type ApiErrorPayload
} from "../services/api-error.js";
import { enqueueSingletonJob } from "../services/job-service.js";
import { maybeGenerateConversationTitle } from "../services/conversation-title-service.js";
import { createBranchFromMessage } from "../services/path-service.js";
import {
  buildAssistantContentSources,
  buildAssistantContentSourcesWithWeb
} from "../services/source-reference-service.js";

const pathParamsSchema = z.object({
  pathId: z.string().uuid()
});

const messagePathParamsSchema = pathParamsSchema.extend({
  messageId: z.string().uuid()
});

const messageAttachmentSchema = z.object({
  dataUrl: z
    .string()
    .startsWith("data:image/")
    .max(7_000_000)
    .optional(),
  id: z.string().trim().min(1).max(120),
  kind: z.enum(["file", "image"]),
  mimeType: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(240),
  size: z.number().int().min(0).max(8_000_000),
  sourceUrl: z.string().trim().min(1).max(500).optional(),
  thumbnailUrl: z.string().trim().min(1).max(500).optional(),
  source: z.enum(["clipboard", "file"]).optional()
});

const createMessageSchema = z.object({
  attachments: z.array(messageAttachmentSchema).max(12).optional().default([]),
  content: z.string().trim().min(1).max(60000),
  modelName: z.string().trim().min(1).max(120).optional(),
  thinkingEnabled: z.boolean().optional().default(false),
  webSearchEnabled: z.boolean().optional().default(false)
});

const updateMessageSchema = createMessageSchema;

const regenerateMessageSchema = z.object({
  modelName: z.string().trim().min(1).max(120).optional(),
  thinkingEnabled: z.boolean().optional().default(false)
});

const editAndRegenerateMessageSchema = regenerateMessageSchema.extend({
  content: z.string().trim().min(1).max(60000)
});

const selectVariantSchema = z.object({
  variantNo: z.number().int().positive()
});

const createBranchSchema = z.object({
  splitFromMessageId: z.string().uuid(),
  splitBlockStartOffset: z.number().int().min(0),
  splitBlockEndOffset: z.number().int().positive(),
  splitBlockType: z.string().trim().min(1).max(32),
  splitFocusText: z.string().trim().min(1).max(2000),
  title: z.string().trim().min(1).max(120).optional(),
  pathType: z
    .enum(["chat", "research", "brainstorm", "critique", "planner", "writer", "merge"])
    .default("chat")
});

const writeSseEvent = (
  raw: NodeJS.WritableStream,
  event: string,
  payload: unknown
) => {
  raw.write(`event: ${event}\n`);
  raw.write(`data: ${JSON.stringify(payload)}\n\n`);
};

const createSseHeaders = (request: FastifyRequest) => ({
  "Access-Control-Allow-Origin": request.headers.origin ?? "*",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "Content-Type": "text/event-stream",
  Vary: "Origin",
  "X-Accel-Buffering": "no"
});

const toErrorText = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

const getChatApiError = (error: unknown, fallback: string): ApiErrorPayload => {
  if (error instanceof MissingAiProviderApiKeyError) {
    return buildApiError({
      action: "Configure key",
      code: "AI_PROVIDER_MISSING_KEY",
      message: "Hosted AI is not configured for this deployment.",
      reason: "provider_missing_key",
      retryable: false,
      title: "Hosted AI is not configured",
      type: "provider"
    });
  }

  if (error instanceof AiProviderCapabilityError) {
    return buildApiError({
      action: "Adjust request",
      code: "AI_PROVIDER_CAPABILITY_UNSUPPORTED",
      message: error.message.includes("Web search")
        ? "Web search works only with hosted Gemini. It is hidden in local Ollama mode."
        : "This model/provider does not support that request mode.",
      reason: "capability_unsupported",
      retryable: false,
      title: error.message.includes("Web search")
        ? "Web search unavailable"
        : "Request mode unavailable",
      type: "validation"
    });
  }

  const providerError = buildProviderApiError(error, fallback);

  return providerError.error.code === "AI_PROVIDER_FAILED"
    ? buildApiError({
        action: "Retry",
        code: "CHAT_GENERATION_FAILED",
        message: fallback,
        reason: "chat_generation_failed",
        retryable: true,
        title: "Bonsai hit an internal error",
        type: "app"
      })
    : providerError;
};

const getErrorStatusCode = (error: unknown) => {
  if (error instanceof MissingAiProviderApiKeyError) {
    return 503;
  }

  if (error instanceof AiProviderCapabilityError) {
    return 400;
  }

  return getProviderStatusCode(error) ?? 500;
};

const compactPathAfterAssistantResponse = (
  request: FastifyRequest,
  modelName: string | null,
  thinkingEnabled: boolean,
  pathId: string,
  userId: string
) => {
  void enqueueSingletonJob({
    dedupeKey: `path_compaction:${pathId}`,
    jobType: "path_compaction",
    maxAttempts: 3,
    payloadJson: {
      pathId,
      modelName,
      reason: "after_assistant_response",
      thinkingEnabled,
      userId
    }
  }).catch((error) => request.log.error(error));
};

const markMessageAttachmentsAttached = async ({
  attachmentIds,
  messageId,
  pathId,
  userId
}: {
  attachmentIds: string[];
  messageId: string;
  pathId: string;
  userId: string;
}) => {
  if (attachmentIds.length === 0) {
    return;
  }

  await attachUploadedAttachmentsToMessage({
    attachmentIds,
    messageId,
    pathId,
    userId
  });
};

export const registerPathRoutes = (server: FastifyInstance) => {
  server.post("/paths/:pathId/branch", async (request, reply) => {
    const params = pathParamsSchema.parse(request.params);
    const body = createBranchSchema.parse(request.body);
    const user = await ensureRequestUser(request);

    const result = await createBranchFromMessage({
      pathType: body.pathType,
      sourcePathId: params.pathId,
      splitBlockEndOffset: body.splitBlockEndOffset,
      splitBlockStartOffset: body.splitBlockStartOffset,
      splitBlockType: body.splitBlockType,
      splitFromMessageId: body.splitFromMessageId,
      splitFocusText: body.splitFocusText,
      title: body.title,
      userId: user.id
    });

    if (!result) {
      return reply.code(404).send({
        error: "Source path not found."
      });
    }

    if ("error" in result) {
      return reply.code(400).send({
        error: result.error
      });
    }

    return reply.code(201).send(result);
  });

  server.get("/paths/:pathId/messages", async (request, reply) => {
    const params = pathParamsSchema.parse(request.params);
    const user = await ensureRequestUser(request);

    const result = await listPathMessages(params.pathId, user.id);

    if (!result) {
      return reply.code(404).send({
        error: "Path not found."
      });
    }

    return reply.send(result);
  });

  server.post("/paths/:pathId/compact", async (request, reply) => {
    const params = pathParamsSchema.parse(request.params);
    const user = await ensureRequestUser(request);
    const contextBundle = await buildContextBundle({
      pathId: params.pathId,
      purpose: "chat_response",
      userId: user.id
    });

    if (!contextBundle) {
      return reply.code(404).send({
        error: "Path not found."
      });
    }

    const job = await enqueueSingletonJob({
      dedupeKey: `path_compaction:${params.pathId}:manual`,
      jobType: "path_compaction",
      maxAttempts: 3,
      payloadJson: {
        pathId: params.pathId,
        reason: "manual",
        userId: user.id
      }
    });

    return reply.code(job.status === "queued" ? 202 : 200).send({
      job,
      status: "queued"
    });
  });

  server.get("/paths/:pathId/context", async (request, reply) => {
    const params = pathParamsSchema.parse(request.params);
    const user = await ensureRequestUser(request);
    const contextBundle = await buildContextBundle({
      pathId: params.pathId,
      purpose: "chat_response",
      userId: user.id
    });

    if (!contextBundle) {
      return reply.code(404).send({
        error: "Path not found."
      });
    }

    return reply.send({
      context: summarizeContextBundle(contextBundle),
      memories: {
        compaction: contextBundle.activeCompaction,
        mergeMemories: contextBundle.mergeMemories,
        snapshot: contextBundle.branchSnapshot
      },
      recentMessages: contextBundle.recentMessages,
      retrievalCandidates: contextBundle.retrievalCandidates
    });
  });

  server.post("/paths/:pathId/messages", async (request, reply) => {
    const params = pathParamsSchema.parse(request.params);
    const body = createMessageSchema.parse(request.body);
    const user = await ensureRequestUser(request);

    const result = await createPathMessage({
      content: body.content,
      contentJson:
        body.attachments.length > 0
          ? {
              attachments: body.attachments
            }
          : null,
      createdBy: "user",
      pathId: params.pathId,
      userId: user.id
    });

    if (!result) {
      return reply.code(404).send({
        error: "Path not found."
      });
    }

    await markMessageAttachmentsAttached({
      attachmentIds: body.attachments.map((attachment) => attachment.id),
      messageId: result.message.id,
      pathId: params.pathId,
      userId: user.id
    });

    let runId: string | null = null;

    try {
      const contextBundle = await buildContextBundle({
        pathId: params.pathId,
        purpose: "chat_response",
        userId: user.id
      });

      if (!contextBundle) {
        return reply.code(404).send({
          error: "Path not found."
        });
      }

      const inferenceProfile = getActiveInferenceProfile();
      const run = await startModelRun({
        cacheMode: "implicit",
        conversationId: result.path.conversationId,
        messageId: result.message.id,
        modelName: inferenceProfile.chatModel,
        modelProvider: inferenceProfile.provider,
        pathId: contextBundle.path.pathId,
        requestPayloadJson: {
          attachmentCount: body.attachments.length,
          contextBundle: summarizeContextBundle(contextBundle),
          selectedModelName: body.modelName ?? null,
          thinkingEnabled: body.thinkingEnabled,
          webSearchEnabled: body.webSearchEnabled
        },
        runType: "chat_response"
      });
      runId = run.id;

      const generated = await generatePathReply({
        history: contextBundle.recentMessages,
        inheritedSnapshotText: contextBundle.branchSnapshot?.snapshotText ?? null,
        memoryContextText: contextBundle.memoryContextText,
        modelName: body.modelName ?? null,
        thinkingEnabled: body.thinkingEnabled,
        webSearchEnabled: body.webSearchEnabled
      });

      const assistantResult = await createAssistantMessage({
        content: generated.text,
        contentJson: buildAssistantContentSourcesWithWeb({
          bundle: contextBundle,
          groundingMetadata: generated.groundingMetadata ?? null
        }),
        modelName: generated.modelName,
        modelProvider: generated.modelProvider,
        pathId: params.pathId,
        userId: user.id
      });

      await completeModelRun({
        cacheMode:
          generated.cacheMode === "explicit"
            ? "explicit"
            : generated.cacheMode === "none"
              ? "none"
              : "implicit",
        cacheRecordId: generated.cacheRecordId ?? null,
        cachedTokens: generated.usage?.cachedTokens ?? null,
        inputTokens: generated.usage?.inputTokens ?? null,
        modelName: generated.modelName,
        modelProvider: generated.modelProvider,
        outputTokens: generated.usage?.outputTokens ?? null,
        responsePayloadJson: {
          groundingMetadata: generated.groundingMetadata ?? null,
          totalTokens: generated.usage?.totalTokens ?? null
        },
        runId
      });

      const conversationTitle = await maybeGenerateConversationTitle({
        conversationId: result.path.conversationId,
        modelName: generated.modelName,
        thinkingEnabled: body.thinkingEnabled,
        pathId: result.path.pathId,
        userId: user.id
      });
      compactPathAfterAssistantResponse(
        request,
        generated.modelName,
        body.thinkingEnabled,
        params.pathId,
        user.id
      );

      return reply.code(201).send({
        assistantMessage: assistantResult?.message ?? null,
        conversationTitle,
        path: result.path,
        userMessage: result.message
      });
    } catch (error) {
      const errorPayload = getChatApiError(error, "Failed to generate assistant response.");

      if (runId) {
        await failModelRun({
          errorText: toErrorText(error, "Chat generation failed."),
          responsePayloadJson: {
            error: errorPayload.error
          },
          runId
        });
      }

      if (errorPayload.error.type === "app") {
        request.log.error(error);
      }

      return reply.code(getErrorStatusCode(error)).send({
        ...errorPayload,
        path: result.path,
        userMessage: result.message
      });
    }
  });

  server.post("/paths/:pathId/messages/stream", async (request, reply) => {
    const params = pathParamsSchema.parse(request.params);
    const body = createMessageSchema.parse(request.body);
    const user = await ensureRequestUser(request);

    const result = await createPathMessage({
      content: body.content,
      contentJson:
        body.attachments.length > 0
          ? {
              attachments: body.attachments
            }
          : null,
      createdBy: "user",
      pathId: params.pathId,
      userId: user.id
    });

    if (!result) {
      return reply.code(404).send({
        error: "Path not found."
      });
    }

    await markMessageAttachmentsAttached({
      attachmentIds: body.attachments.map((attachment) => attachment.id),
      messageId: result.message.id,
      pathId: params.pathId,
      userId: user.id
    });

    let runId: string | null = null;
    let fullText = "";
    let streamedModelName: string | null = null;
    let streamedModelProvider: string | null = null;
    let streamOpened = false;
    let groundingMetadata: unknown = null;
    let assistantContentSources: Record<string, unknown> = {
      sources: []
    };

    try {
      const contextBundle = await buildContextBundle({
        pathId: params.pathId,
        purpose: "chat_response",
        userId: user.id
      });

      if (!contextBundle) {
        return reply.code(404).send({
          error: "Path not found."
        });
      }
      assistantContentSources = buildAssistantContentSources(contextBundle);
      const inferenceProfile = getActiveInferenceProfile();
      const run = await startModelRun({
        cacheMode: "implicit",
        conversationId: result.path.conversationId,
        messageId: result.message.id,
        modelName: inferenceProfile.chatModel,
        modelProvider: inferenceProfile.provider,
        pathId: contextBundle.path.pathId,
        requestPayloadJson: {
          attachmentCount: body.attachments.length,
          contextBundle: summarizeContextBundle(contextBundle),
          selectedModelName: body.modelName ?? null,
          thinkingEnabled: body.thinkingEnabled,
          streaming: true,
          webSearchEnabled: body.webSearchEnabled
        },
        runType: "chat_response"
      });
      runId = run.id;

      const streamed = await streamPathReply({
        history: contextBundle.recentMessages,
        inheritedSnapshotText: contextBundle.branchSnapshot?.snapshotText ?? null,
        memoryContextText: contextBundle.memoryContextText,
        modelName: body.modelName ?? null,
        thinkingEnabled: body.thinkingEnabled,
        webSearchEnabled: body.webSearchEnabled
      });
      streamedModelName = streamed.modelName;
      streamedModelProvider = streamed.modelProvider;

      reply.hijack();
      reply.raw.writeHead(200, createSseHeaders(request));
      streamOpened = true;

      writeSseEvent(reply.raw, "run.started", {
        modelName: streamed.modelName,
        modelProvider: streamed.modelProvider,
        runId,
        pathId: result.path.pathId,
        userMessageId: result.message.id
      });

      for await (const chunk of streamed.stream) {
        const text = chunk.text ?? "";

        if (!text) {
          continue;
        }

        fullText += text;

        writeSseEvent(reply.raw, "message.delta", {
          text
        });
      }

      const assistantResult = await createAssistantMessage({
        content: fullText.trim(),
        contentJson: buildAssistantContentSourcesWithWeb({
          bundle: contextBundle,
          groundingMetadata: streamed.groundingMetadata.current
        }),
        modelName: streamed.modelName,
        modelProvider: streamed.modelProvider,
        pathId: params.pathId,
        userId: user.id
      });

      await completeModelRun({
        cacheMode:
          streamed.cacheMode === "explicit"
            ? "explicit"
            : streamed.cacheMode === "none"
              ? "none"
              : "implicit",
        cacheRecordId: streamed.cacheRecordId ?? null,
        cachedTokens: streamed.usage?.cachedTokens ?? null,
        inputTokens: streamed.usage?.inputTokens ?? null,
        modelName: streamed.modelName,
        modelProvider: streamed.modelProvider,
        outputTokens: streamed.usage?.outputTokens ?? null,
        responsePayloadJson: {
          groundingMetadata: streamed.groundingMetadata.current,
          totalTokens: streamed.usage?.totalTokens ?? null
        },
        runId
      });

      const conversationTitle = await maybeGenerateConversationTitle({
        conversationId: result.path.conversationId,
        modelName: streamed.modelName,
        thinkingEnabled: body.thinkingEnabled,
        pathId: result.path.pathId,
        userId: user.id
      });
      compactPathAfterAssistantResponse(
        request,
        streamed.modelName,
        body.thinkingEnabled,
        params.pathId,
        user.id
      );

      writeSseEvent(reply.raw, "message.completed", {
        assistantMessage: assistantResult?.message ?? null,
        conversationTitle,
        path: result.path,
        userMessage: result.message
      });

      writeSseEvent(reply.raw, "run.completed", {
        ok: true
      });

      reply.raw.end();
      return;
    } catch (error) {
      const errorPayload = getChatApiError(error, "Failed to stream assistant response.");
      const responsePayloadJson = {
        error: errorPayload.error,
        partialTextLength: fullText.length
      };
      const failedAssistantResult = await createAssistantMessage({
        content:
          fullText.trim() ||
          "Assistant response failed before any text was returned.",
        contentJson: {
          ...assistantContentSources,
          resilience: {
            error: errorPayload.error,
            modelRunId: runId,
            partial: fullText.trim().length > 0,
            retryFromUserMessageId: result.message.id
          }
        },
        modelName: streamedModelName ?? getActiveInferenceProfile().chatModel,
        modelProvider: streamedModelProvider ?? getActiveInferenceProfile().provider,
        pathId: params.pathId,
        status: "failed",
        userId: user.id
      });

      if (runId) {
        await failModelRun({
          errorText: toErrorText(error, "Streaming failed."),
          responsePayloadJson: {
            ...responsePayloadJson,
            failedAssistantMessageId: failedAssistantResult?.message.id ?? null
          },
          runId
        });
      }

      if (errorPayload.error.type === "app") {
        request.log.error(error);
      }

      if (!streamOpened) {
        reply.hijack();
        reply.raw.writeHead(getErrorStatusCode(error), createSseHeaders(request));
        streamOpened = true;
      }

      writeSseEvent(reply.raw, "run.error", {
        assistantMessage: failedAssistantResult?.message ?? null,
        error: errorPayload.error,
        message: errorPayload.message,
        path: result.path,
        runId,
        userMessage: result.message
      });
      reply.raw.end();
      return;
    }
  });

  server.patch("/paths/:pathId/messages/:messageId", async (request, reply) => {
    const params = messagePathParamsSchema.parse(request.params);
    const body = updateMessageSchema.parse(request.body);
    const user = await ensureRequestUser(request);

    const result = await updatePathUserMessage({
      content: body.content,
      messageId: params.messageId,
      pathId: params.pathId,
      userId: user.id
    });

    if (!result) {
      return reply.code(404).send({
        error: "User message not found."
      });
    }

    return reply.send(result);
  });

  server.post(
    "/paths/:pathId/messages/:messageId/edit/regenerate/stream",
    async (request, reply) => {
      const params = messagePathParamsSchema.parse(request.params);
      const body = editAndRegenerateMessageSchema.parse(request.body ?? {});
      const user = await ensureRequestUser(request);
      let editResult: Awaited<ReturnType<typeof updateLatestUserMessageForRegeneration>>;

      try {
        editResult = await updateLatestUserMessageForRegeneration({
          content: body.content,
          messageId: params.messageId,
          pathId: params.pathId,
          userId: user.id
        });
      } catch (error) {
        if (error instanceof MessageEditRegenerationError) {
          return reply.code(error.statusCode).send({
            error: error.message
          });
        }

        throw error;
      }

      if (!editResult) {
        return reply.code(404).send({
          error: "User message not found."
        });
      }

      const contextBundle = await buildContextBundle({
        beforeAssistantMessageId: editResult.assistantMessage.id,
        pathId: params.pathId,
        purpose: "regenerate",
        userId: user.id
      });

      if (!contextBundle || !contextBundle.sourceUserMessage) {
        return reply.code(404).send({
          error: "Assistant response not found."
        });
      }

      let runId: string | null = null;
      let fullText = "";
      let streamedModelName: string | null = null;
      let streamedModelProvider: string | null = null;
      let streamOpened = false;
      let groundingMetadata: unknown = null;

      try {
        const inferenceProfile = getActiveInferenceProfile();
        const contextBundleSummary = summarizeContextBundle(contextBundle);
        const run = await startModelRun({
          cacheMode: "implicit",
          conversationId: contextBundle.path.conversationId,
          messageId: contextBundle.sourceUserMessage.id,
          modelName: inferenceProfile.chatModel,
          modelProvider: inferenceProfile.provider,
          pathId: contextBundle.path.pathId,
          requestPayloadJson: {
            contextBundle: contextBundleSummary,
            editedUserMessageId: editResult.userMessage.id,
            regeneratedFromMessageId: editResult.assistantMessage.id,
            selectedModelName: body.modelName ?? null,
            thinkingEnabled: body.thinkingEnabled,
            streaming: true
          },
          runType: "chat_response"
        });
        runId = run.id;

        const streamed = await streamPathReply({
          history: contextBundle.recentMessages,
          inheritedSnapshotText: contextBundle.branchSnapshot?.snapshotText ?? null,
          memoryContextText: contextBundle.memoryContextText,
          modelName: body.modelName ?? null,
          thinkingEnabled: body.thinkingEnabled
        });
        streamedModelName = streamed.modelName;
        streamedModelProvider = streamed.modelProvider;

        reply.hijack();
        reply.raw.writeHead(200, createSseHeaders(request));
        streamOpened = true;

        writeSseEvent(reply.raw, "run.started", {
          modelName: streamed.modelName,
          modelProvider: streamed.modelProvider,
          runId,
          pathId: contextBundle.path.pathId,
          userMessageId: contextBundle.sourceUserMessage.id
        });

        for await (const chunk of streamed.stream) {
          const text = chunk.text ?? "";

          if (!text) {
            continue;
          }

          fullText += text;

          writeSseEvent(reply.raw, "message.delta", {
            text
          });
        }
        groundingMetadata = streamed.groundingMetadata.current;

        const assistantResult = await updatePathAssistantMessage({
          content: fullText.trim(),
          contentJsonPatch: buildAssistantContentSourcesWithWeb({
            bundle: contextBundle,
            groundingMetadata
          }),
          lineage: {
            contextBundle: contextBundleSummary,
            modelRunId: run.id,
            sourceUserMessageId: contextBundle.sourceUserMessage.id
          },
          messageId: editResult.assistantMessage.id,
          modelName: streamed.modelName,
          modelProvider: streamed.modelProvider,
          pathId: params.pathId,
          userId: user.id
        });

        await completeModelRun({
          cacheMode:
            streamed.cacheMode === "explicit"
              ? "explicit"
              : streamed.cacheMode === "none"
                ? "none"
                : "implicit",
          cacheRecordId: streamed.cacheRecordId ?? null,
          cachedTokens: streamed.usage?.cachedTokens ?? null,
          inputTokens: streamed.usage?.inputTokens ?? null,
          modelName: streamed.modelName,
          modelProvider: streamed.modelProvider,
          outputTokens: streamed.usage?.outputTokens ?? null,
          responsePayloadJson: {
            editedUserMessageId: editResult.userMessage.id,
            regeneratedFromMessageId: editResult.assistantMessage.id,
            totalTokens: streamed.usage?.totalTokens ?? null
          },
          runId
        });
        compactPathAfterAssistantResponse(
          request,
          streamed.modelName,
          body.thinkingEnabled,
          params.pathId,
          user.id
        );

        writeSseEvent(reply.raw, "message.completed", {
          assistantMessage: assistantResult?.message ?? null,
          conversationTitle: null,
          path: contextBundle.path,
          userMessage: contextBundle.sourceUserMessage
        });

        writeSseEvent(reply.raw, "run.completed", {
          ok: true
        });

        reply.raw.end();
        return;
      } catch (error) {
        const errorPayload = getChatApiError(
          error,
          "Failed to regenerate edited assistant response."
        );
        const failedAssistantResult = await updatePathAssistantMessage({
          content:
            fullText.trim() ||
            "Assistant response failed before any text was returned.",
          contentJsonPatch: {
            ...buildAssistantContentSourcesWithWeb({
              bundle: contextBundle,
              groundingMetadata
            }),
            resilience: {
              error: errorPayload.error,
              modelRunId: runId,
              partial: fullText.trim().length > 0,
              retryFromUserMessageId: contextBundle.sourceUserMessage.id
            }
          },
          lineage: runId
            ? {
                contextBundle: summarizeContextBundle(contextBundle),
                modelRunId: runId,
                sourceUserMessageId: contextBundle.sourceUserMessage.id
              }
            : undefined,
          messageId: editResult.assistantMessage.id,
          modelName: streamedModelName ?? getActiveInferenceProfile().chatModel,
          modelProvider: streamedModelProvider ?? getActiveInferenceProfile().provider,
          pathId: params.pathId,
          status: "failed",
          userId: user.id
        });

        if (runId) {
          await failModelRun({
            errorText: toErrorText(error, "Streaming failed."),
            responsePayloadJson: {
              error: errorPayload.error,
              editedUserMessageId: editResult.userMessage.id,
              failedAssistantMessageId: failedAssistantResult?.message.id ?? null,
              partialTextLength: fullText.length,
              regeneratedFromMessageId: editResult.assistantMessage.id
            },
            runId
          });
        }

        if (errorPayload.error.type === "app") {
          request.log.error(error);
        }

        if (!streamOpened) {
          reply.hijack();
          reply.raw.writeHead(getErrorStatusCode(error), createSseHeaders(request));
          streamOpened = true;
        }

        writeSseEvent(reply.raw, "run.error", {
          assistantMessage: failedAssistantResult?.message ?? null,
          error: errorPayload.error,
          message: errorPayload.message,
          path: contextBundle.path,
          runId,
          userMessage: contextBundle.sourceUserMessage
        });
        reply.raw.end();
        return;
      }
    }
  );

  server.post("/paths/:pathId/messages/:messageId/regenerate/stream", async (request, reply) => {
    const params = messagePathParamsSchema.parse(request.params);
    const body = regenerateMessageSchema.parse(request.body ?? {});
    const user = await ensureRequestUser(request);
    const contextBundle = await buildContextBundle({
      beforeAssistantMessageId: params.messageId,
      pathId: params.pathId,
      purpose: "regenerate",
      userId: user.id
    });

    if (!contextBundle || !contextBundle.sourceUserMessage) {
      return reply.code(404).send({
        error: "Assistant message not found."
      });
    }

    let runId: string | null = null;
    let fullText = "";
    let streamedModelName: string | null = null;
    let streamedModelProvider: string | null = null;
    let streamOpened = false;
    let groundingMetadata: unknown = null;

    try {
      const inferenceProfile = getActiveInferenceProfile();
      const run = await startModelRun({
        cacheMode: "implicit",
        conversationId: contextBundle.path.conversationId,
        messageId: contextBundle.sourceUserMessage.id,
        modelName: inferenceProfile.chatModel,
        modelProvider: inferenceProfile.provider,
        pathId: contextBundle.path.pathId,
        requestPayloadJson: {
          contextBundle: summarizeContextBundle(contextBundle),
          regeneratedFromMessageId: params.messageId,
          selectedModelName: body.modelName ?? null,
          thinkingEnabled: body.thinkingEnabled,
          streaming: true
        },
        runType: "chat_response"
      });
      runId = run.id;
      const contextBundleSummary = summarizeContextBundle(contextBundle);

      const streamed = await streamPathReply({
        history: contextBundle.recentMessages,
        inheritedSnapshotText: contextBundle.branchSnapshot?.snapshotText ?? null,
        memoryContextText: contextBundle.memoryContextText,
        modelName: body.modelName ?? null,
        thinkingEnabled: body.thinkingEnabled
      });
      streamedModelName = streamed.modelName;
      streamedModelProvider = streamed.modelProvider;

      reply.hijack();
      reply.raw.writeHead(200, createSseHeaders(request));
      streamOpened = true;

      writeSseEvent(reply.raw, "run.started", {
        modelName: streamed.modelName,
        modelProvider: streamed.modelProvider,
        runId,
        pathId: contextBundle.path.pathId,
        userMessageId: contextBundle.sourceUserMessage.id
      });

      for await (const chunk of streamed.stream) {
        const text = chunk.text ?? "";

        if (!text) {
          continue;
        }

        fullText += text;

        writeSseEvent(reply.raw, "message.delta", {
          text
        });
      }
      groundingMetadata = streamed.groundingMetadata.current;

      const assistantResult = await updatePathAssistantMessage({
        content: fullText.trim(),
        contentJsonPatch: buildAssistantContentSourcesWithWeb({
          bundle: contextBundle,
          groundingMetadata
        }),
        lineage: {
          contextBundle: contextBundleSummary,
          modelRunId: run.id,
          sourceUserMessageId: contextBundle.sourceUserMessage.id
        },
        messageId: params.messageId,
        modelName: streamed.modelName,
        modelProvider: streamed.modelProvider,
        pathId: params.pathId,
        userId: user.id
      });

      await completeModelRun({
        cacheMode:
          streamed.cacheMode === "explicit"
            ? "explicit"
            : streamed.cacheMode === "none"
              ? "none"
              : "implicit",
        cacheRecordId: streamed.cacheRecordId ?? null,
        cachedTokens: streamed.usage?.cachedTokens ?? null,
        inputTokens: streamed.usage?.inputTokens ?? null,
        modelName: streamed.modelName,
        modelProvider: streamed.modelProvider,
        outputTokens: streamed.usage?.outputTokens ?? null,
        responsePayloadJson: {
          regeneratedFromMessageId: params.messageId,
          totalTokens: streamed.usage?.totalTokens ?? null
        },
        runId
      });
      compactPathAfterAssistantResponse(
        request,
        streamed.modelName,
        body.thinkingEnabled,
        params.pathId,
        user.id
      );

      writeSseEvent(reply.raw, "message.completed", {
        assistantMessage: assistantResult?.message ?? null,
        conversationTitle: null,
        path: contextBundle.path,
        userMessage: contextBundle.sourceUserMessage
      });

      writeSseEvent(reply.raw, "run.completed", {
        ok: true
      });

      reply.raw.end();
      return;
    } catch (error) {
      const errorPayload = getChatApiError(error, "Failed to regenerate assistant response.");
      const failedAssistantResult = fullText.trim()
        ? await updatePathAssistantMessage({
            content: fullText.trim(),
            contentJsonPatch: {
              ...buildAssistantContentSourcesWithWeb({
                bundle: contextBundle,
                groundingMetadata
              }),
              resilience: {
                error: errorPayload.error,
                modelRunId: runId,
                partial: true,
                retryFromUserMessageId: contextBundle.sourceUserMessage.id
              }
            },
            lineage: runId
              ? {
                  contextBundle: summarizeContextBundle(contextBundle),
                  modelRunId: runId,
                  sourceUserMessageId: contextBundle.sourceUserMessage.id
                }
              : undefined,
            messageId: params.messageId,
            modelName: streamedModelName ?? getActiveInferenceProfile().chatModel,
            modelProvider: streamedModelProvider ?? getActiveInferenceProfile().provider,
            pathId: params.pathId,
            status: "failed",
            userId: user.id
          })
        : null;

      if (runId) {
        await failModelRun({
          errorText: toErrorText(error, "Streaming failed."),
          responsePayloadJson: {
            error: errorPayload.error,
            failedAssistantMessageId: failedAssistantResult?.message.id ?? null,
            partialTextLength: fullText.length,
            regeneratedFromMessageId: params.messageId
          },
          runId
        });
      }

      if (errorPayload.error.type === "app") {
        request.log.error(error);
      }

      if (!streamOpened) {
        reply.hijack();
        reply.raw.writeHead(getErrorStatusCode(error), createSseHeaders(request));
        streamOpened = true;
      }

      writeSseEvent(reply.raw, "run.error", {
        assistantMessage: failedAssistantResult?.message ?? null,
        error: errorPayload.error,
        message: errorPayload.message,
        path: contextBundle.path,
        runId,
        userMessage: contextBundle.sourceUserMessage
      });
      reply.raw.end();
      return;
    }
  });

  server.patch("/paths/:pathId/messages/:messageId/variant", async (request, reply) => {
    const params = messagePathParamsSchema.parse(request.params);
    const body = selectVariantSchema.parse(request.body);
    const user = await ensureRequestUser(request);
    const result = await selectPathAssistantMessageVariant({
      messageId: params.messageId,
      pathId: params.pathId,
      userId: user.id,
      variantNo: body.variantNo
    });

    if (!result) {
      return reply.code(404).send({
        error: "Assistant variant not found."
      });
    }

    return reply.send(result);
  });
};
