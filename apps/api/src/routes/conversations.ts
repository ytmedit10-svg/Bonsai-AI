import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  createConversationWithMainPath,
  createOrGetConversationShare,
  deleteConversation,
  getConversationSummary,
  getSharedConversation,
  listConversationsForUser,
  updateConversation
} from "../services/conversation-service.js";
import {
  getConversationViewState,
  updateConversationViewState
} from "../services/conversation-view-state-service.js";
import { ensureBootstrapUser } from "../services/bootstrap-user-service.js";
import { listConversationMerges } from "../services/merge-service.js";
import { listConversationPaths } from "../services/path-service.js";

const createConversationSchema = z.object({
  title: z.string().trim().min(1).max(120)
});

const conversationParamsSchema = z.object({
  conversationId: z.string().uuid()
});

const shareParamsSchema = z.object({
  shareToken: z.string().trim().min(16).max(160)
});

const updateConversationSchema = z
  .object({
    pinned: z.boolean().optional(),
    title: z.string().trim().min(1).max(120).optional()
  })
  .refine((body) => body.pinned !== undefined || body.title !== undefined, {
    message: "At least one conversation field is required."
  });

const updateConversationViewStateSchema = z.object({
  lastActivePathId: z.string().uuid().nullable()
});

export const registerConversationRoutes = (server: FastifyInstance) => {
  server.get("/conversations", async () => {
    const user = await ensureBootstrapUser();
    return listConversationsForUser(user.id);
  });

  server.post("/conversations", async (request, reply) => {
    const body = createConversationSchema.parse(request.body);
    const user = await ensureBootstrapUser();

    const result = await createConversationWithMainPath({
      title: body.title,
      userId: user.id
    });

    return reply.code(201).send({
      conversation: result.conversation,
      mainPath: result.mainPath
    });
  });

  server.get("/shared/conversations/:shareToken", async (request, reply) => {
    const params = shareParamsSchema.parse(request.params);
    const result = await getSharedConversation(params.shareToken);

    if (!result) {
      return reply.code(404).send({
        error: "Shared conversation not found."
      });
    }

    return reply.send(result);
  });

  server.get("/conversations/:conversationId", async (request, reply) => {
    const params = conversationParamsSchema.parse(request.params);
    const user = await ensureBootstrapUser();

    const summary = await getConversationSummary(params.conversationId, user.id);

    if (!summary) {
      return reply.code(404).send({
        error: "Conversation not found."
      });
    }

    return reply.send(summary);
  });

  server.patch("/conversations/:conversationId", async (request, reply) => {
    const params = conversationParamsSchema.parse(request.params);
    const body = updateConversationSchema.parse(request.body);
    const user = await ensureBootstrapUser();

    const conversation = await updateConversation({
      conversationId: params.conversationId,
      pinned: body.pinned,
      title: body.title,
      userId: user.id
    });

    if (!conversation) {
      return reply.code(404).send({
        error: "Conversation not found."
      });
    }

    return reply.send({
      conversation
    });
  });

  server.delete("/conversations/:conversationId", async (request, reply) => {
    const params = conversationParamsSchema.parse(request.params);
    const user = await ensureBootstrapUser();

    const conversation = await deleteConversation(params.conversationId, user.id);

    if (!conversation) {
      return reply.code(404).send({
        error: "Conversation not found."
      });
    }

    return reply.code(204).send();
  });

  server.post("/conversations/:conversationId/share", async (request, reply) => {
    const params = conversationParamsSchema.parse(request.params);
    const user = await ensureBootstrapUser();

    const result = await createOrGetConversationShare(params.conversationId, user.id);

    if (!result) {
      return reply.code(404).send({
        error: "Conversation not found."
      });
    }

    const sharePath = `/shared/${result.share.token}`;
    const origin = request.headers.origin;

    return reply.send({
      conversation: result.conversation,
      share: result.share,
      sharePath,
      shareUrl: origin ? `${origin}${sharePath}` : sharePath
    });
  });

  server.get("/conversations/:conversationId/paths", async (request, reply) => {
    const params = conversationParamsSchema.parse(request.params);
    const user = await ensureBootstrapUser();

    const result = await listConversationPaths(params.conversationId, user.id);

    if (!result) {
      return reply.code(404).send({
        error: "Conversation not found."
      });
    }

    return reply.send(result);
  });

  server.get("/conversations/:conversationId/merges", async (request, reply) => {
    const params = conversationParamsSchema.parse(request.params);
    const user = await ensureBootstrapUser();

    const result = await listConversationMerges(params.conversationId, user.id);

    if (!result) {
      return reply.code(404).send({
        error: "Conversation not found."
      });
    }

    return reply.send(result);
  });

  server.get("/conversations/:conversationId/view-state", async (request, reply) => {
    const params = conversationParamsSchema.parse(request.params);
    const user = await ensureBootstrapUser();

    const result = await getConversationViewState(params.conversationId, user.id);

    if (!result) {
      return reply.code(404).send({
        error: "Conversation not found."
      });
    }

    return reply.send(result);
  });

  server.put("/conversations/:conversationId/view-state", async (request, reply) => {
    const params = conversationParamsSchema.parse(request.params);
    const body = updateConversationViewStateSchema.parse(request.body);
    const user = await ensureBootstrapUser();

    const result = await updateConversationViewState({
      conversationId: params.conversationId,
      lastActivePathId: body.lastActivePathId,
      userId: user.id
    });

    if (!result) {
      return reply.code(404).send({
        error: "Conversation not found."
      });
    }

    if ("error" in result) {
      return reply.code(400).send({
        error: result.error
      });
    }

    return reply.send(result);
  });
};
