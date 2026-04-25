import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import {
  createAssistantMessage,
  createPathMessage,
  getRecentPathMessagesForGeneration,
  listPathMessages
} from "../services/message-service.js";
import { ensureBootstrapUser } from "../services/bootstrap-user-service.js";
import {
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
import { maybeGenerateConversationTitle } from "../services/conversation-title-service.js";
import { createBranchFromMessage } from "../services/path-service.js";

const pathParamsSchema = z.object({
  pathId: z.string().uuid()
});

const createMessageSchema = z.object({
  content: z.string().trim().min(1).max(8000)
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

const getProviderError = (error: unknown) => {
  if (!error || typeof error !== "object") {
    return null;
  }

  const maybeStatus = "status" in error ? error.status : null;
  const maybeMessage = "message" in error ? error.message : null;

  if (typeof maybeStatus === "number" && typeof maybeMessage === "string") {
    let message = maybeMessage;

    try {
      const parsedOuter = JSON.parse(maybeMessage) as {
        error?: {
          message?: string;
          code?: number;
          status?: string;
        };
      };

      if (parsedOuter.error?.message) {
        try {
          const parsedInner = JSON.parse(parsedOuter.error.message) as {
            error?: {
              message?: string;
            };
          };

          message = parsedInner.error?.message ?? parsedOuter.error.message;
        } catch {
          message = parsedOuter.error.message;
        }
      }
    } catch {
      message = maybeMessage;
    }

    return {
      message,
      statusCode: maybeStatus
    };
  }

  return null;
};

export const registerPathRoutes = (server: FastifyInstance) => {
  server.post("/paths/:pathId/branch", async (request, reply) => {
    const params = pathParamsSchema.parse(request.params);
    const body = createBranchSchema.parse(request.body);
    const user = await ensureBootstrapUser();

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
    const user = await ensureBootstrapUser();

    const result = await listPathMessages(params.pathId, user.id);

    if (!result) {
      return reply.code(404).send({
        error: "Path not found."
      });
    }

    return reply.send(result);
  });

  server.post("/paths/:pathId/messages", async (request, reply) => {
    const params = pathParamsSchema.parse(request.params);
    const body = createMessageSchema.parse(request.body);
    const user = await ensureBootstrapUser();

    const result = await createPathMessage({
      content: body.content,
      createdBy: "user",
      pathId: params.pathId,
      userId: user.id
    });

    if (!result) {
      return reply.code(404).send({
        error: "Path not found."
      });
    }

    let runId: string | null = null;

    try {
      const generationContext = await getRecentPathMessagesForGeneration(
        params.pathId,
        user.id
      );

      if (!generationContext) {
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
        pathId: result.path.pathId,
        requestPayloadJson: {
          inheritedSnapshot: Boolean(generationContext.snapshot?.snapshotText),
          recentMessages: generationContext.messages.length
        },
        runType: "chat_response"
      });
      runId = run.id;

      const generated = await generatePathReply({
        history: generationContext.messages,
        inheritedSnapshotText: generationContext.snapshot?.snapshotText ?? null
      });

      const assistantResult = await createAssistantMessage({
        content: generated.text,
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
          totalTokens: generated.usage?.totalTokens ?? null
        },
        runId
      });

      const conversationTitle = await maybeGenerateConversationTitle({
        conversationId: result.path.conversationId,
        pathId: result.path.pathId,
        userId: user.id
      });

      return reply.code(201).send({
        assistantMessage: assistantResult?.message ?? null,
        conversationTitle,
        path: result.path,
        userMessage: result.message
      });
    } catch (error) {
      if (runId) {
        await failModelRun({
          errorText: error instanceof Error ? error.message : "Chat generation failed.",
          runId
        });
      }

      if (error instanceof MissingAiProviderApiKeyError) {
        return reply.code(503).send({
          error: error.message,
          path: result.path,
          userMessage: result.message
        });
      }

      const providerError = getProviderError(error);

      if (providerError) {
        return reply.code(providerError.statusCode).send({
          error: providerError.message,
          path: result.path,
          userMessage: result.message
        });
      }

      request.log.error(error);

      return reply.code(500).send({
        error: "Failed to generate assistant response.",
        path: result.path,
        userMessage: result.message
      });
    }
  });

  server.post("/paths/:pathId/messages/stream", async (request, reply) => {
    const params = pathParamsSchema.parse(request.params);
    const body = createMessageSchema.parse(request.body);
    const user = await ensureBootstrapUser();

    const result = await createPathMessage({
      content: body.content,
      createdBy: "user",
      pathId: params.pathId,
      userId: user.id
    });

    if (!result) {
      return reply.code(404).send({
        error: "Path not found."
      });
    }

    let runId: string | null = null;

    try {
      const generationContext = await getRecentPathMessagesForGeneration(
        params.pathId,
        user.id
      );

      if (!generationContext) {
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
        pathId: result.path.pathId,
        requestPayloadJson: {
          inheritedSnapshot: Boolean(generationContext.snapshot?.snapshotText),
          recentMessages: generationContext.messages.length,
          streaming: true
        },
        runType: "chat_response"
      });
      runId = run.id;

      const streamed = await streamPathReply({
        history: generationContext.messages,
        inheritedSnapshotText: generationContext.snapshot?.snapshotText ?? null
      });

      reply.hijack();
      reply.raw.writeHead(200, createSseHeaders(request));

      writeSseEvent(reply.raw, "run.started", {
        modelName: streamed.modelName,
        modelProvider: streamed.modelProvider,
        pathId: result.path.pathId,
        userMessageId: result.message.id
      });

      let fullText = "";

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
          totalTokens: streamed.usage?.totalTokens ?? null
        },
        runId
      });

      const conversationTitle = await maybeGenerateConversationTitle({
        conversationId: result.path.conversationId,
        pathId: result.path.pathId,
        userId: user.id
      });

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
      if (runId) {
        await failModelRun({
          errorText: error instanceof Error ? error.message : "Streaming failed.",
          runId
        });
      }

      if (error instanceof MissingAiProviderApiKeyError) {
        reply.hijack();
        reply.raw.writeHead(503, createSseHeaders(request));
        writeSseEvent(reply.raw, "run.error", {
          error: error.message,
          path: result.path,
          userMessage: result.message
        });
        reply.raw.end();
        return;
      }

      const providerError = getProviderError(error);

      if (providerError) {
        reply.hijack();
        reply.raw.writeHead(providerError.statusCode, createSseHeaders(request));
        writeSseEvent(reply.raw, "run.error", {
          error: providerError.message,
          path: result.path,
          userMessage: result.message
        });
        reply.raw.end();
        return;
      }

      request.log.error(error);

      reply.hijack();
      reply.raw.writeHead(500, createSseHeaders(request));
      writeSseEvent(reply.raw, "run.error", {
        error: "Failed to stream assistant response.",
        path: result.path,
        userMessage: result.message
      });
      reply.raw.end();
      return;
    }
  });
};
