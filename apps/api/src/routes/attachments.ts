import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { ensureRequestUser } from "../services/bootstrap-user-service.js";
import {
  MissingR2ConfigError,
  streamAttachment,
  uploadAttachment
} from "../services/attachment-service.js";
import { buildApiError } from "../services/api-error.js";

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
        return reply.code(404).send(
          buildApiError({
            action: "Refresh",
            code: "PATH_NOT_FOUND",
            message: "This chat path could not be found. Refresh and try again.",
            reason: "path_not_found",
            title: "Chat path missing",
            type: "validation"
          })
        );
      }

      return reply.code(201).send({
        attachment
      });
    } catch (error) {
      if (error instanceof MissingR2ConfigError) {
        return reply.code(503).send(
          buildApiError({
            action: "Retry",
            code: "UPLOAD_STORAGE_UNCONFIGURED",
            message: "Attachment storage is not configured for this deployment.",
            reason: "upload_storage_unconfigured",
            retryable: false,
            title: "Uploads are unavailable",
            type: "app"
          })
        );
      }

      return reply.code(400).send(
        buildApiError({
          action: "Retry",
          code: "ATTACHMENT_UPLOAD_FAILED",
          message: "This attachment could not be uploaded. Try a smaller file or retry.",
          reason: "attachment_upload_failed",
          retryable: true,
          title: "Attachment upload failed",
          type: "validation"
        })
      );
    }
  });

  server.get("/attachments/:attachmentId/content", async (request, reply) => {
    const params = attachmentParamsSchema.parse(request.params);
    const user = await ensureRequestUser(request);

    try {
      const result = await streamAttachment(params.attachmentId, user.id);

      if (!result) {
        return reply.code(404).send(
          buildApiError({
            action: "Refresh",
            code: "ATTACHMENT_NOT_FOUND",
            message: "That attachment could not be found. Refresh and try again.",
            reason: "attachment_not_found",
            title: "Attachment missing",
            type: "validation"
          })
        );
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
        return reply.code(503).send(
          buildApiError({
            action: "Retry",
            code: "UPLOAD_STORAGE_UNCONFIGURED",
            message: "Attachment storage is not configured for this deployment.",
            reason: "upload_storage_unconfigured",
            retryable: false,
            title: "Uploads are unavailable",
            type: "app"
          })
        );
      }

      request.log.error(error);
      return reply.code(502).send(
        buildApiError({
          action: "Retry",
          code: "ATTACHMENT_READ_FAILED",
          message: "Bonsai could not read that attachment. Retry once, then upload it again if it repeats.",
          reason: "attachment_read_failed",
          retryable: true,
          title: "Attachment could not be opened",
          type: "app"
        })
      );
    }
  });
};
