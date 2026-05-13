import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { ensureRequestUser } from "../services/bootstrap-user-service.js";
import {
  MissingR2ConfigError,
  streamAttachment,
  uploadAttachment
} from "../services/attachment-service.js";

const attachmentParamsSchema = z.object({
  attachmentId: z.string().uuid()
});

const pathParamsSchema = z.object({
  pathId: z.string().uuid()
});

const uploadAttachmentSchema = z.object({
  data: z.string().min(1),
  mimeType: z.string().trim().min(1).max(160),
  name: z.string().trim().min(1).max(240),
  size: z.number().int().positive().max(8_000_000),
  source: z.enum(["clipboard", "file"]).optional()
});

export const registerAttachmentRoutes = (server: FastifyInstance) => {
  server.post("/paths/:pathId/attachments", async (request, reply) => {
    const params = pathParamsSchema.parse(request.params);
    const body = uploadAttachmentSchema.parse(request.body);
    const user = await ensureRequestUser(request);

    try {
      const attachment = await uploadAttachment({
        data: body.data,
        mimeType: body.mimeType,
        name: body.name,
        pathId: params.pathId,
        size: body.size,
        source: body.source,
        userId: user.id
      });

      if (!attachment) {
        return reply.code(404).send({
          error: "Path not found."
        });
      }

      return reply.code(201).send({
        attachment
      });
    } catch (error) {
      if (error instanceof MissingR2ConfigError) {
        return reply.code(503).send({
          error: error.message
        });
      }

      return reply.code(400).send({
        error: error instanceof Error ? error.message : "Attachment upload failed."
      });
    }
  });

  server.get("/attachments/:attachmentId/content", async (request, reply) => {
    const params = attachmentParamsSchema.parse(request.params);
    const user = await ensureRequestUser(request);

    try {
      const result = await streamAttachment(params.attachmentId, user.id);

      if (!result) {
        return reply.code(404).send({
          error: "Attachment not found."
        });
      }

      reply.header("Content-Type", result.attachment.mimeType);
      reply.header("Content-Length", result.attachment.byteSize.toString());
      reply.header(
        "Content-Disposition",
        `inline; filename="${result.attachment.originalName.replace(/"/g, "")}"`
      );

      return reply.send(result.body);
    } catch (error) {
      if (error instanceof MissingR2ConfigError) {
        return reply.code(503).send({
          error: error.message
        });
      }

      request.log.error(error);
      return reply.code(502).send({
        error: "Failed to read attachment."
      });
    }
  });
};
