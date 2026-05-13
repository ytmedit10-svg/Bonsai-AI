import { createReadStream } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { and, asc, eq, inArray, lt } from "drizzle-orm";

import { loadEnv } from "../config/env.js";
import { db } from "../db/client.js";
import { attachments, conversations, paths } from "../db/schema.js";
import { enqueueEmbeddingForSource } from "./embedding-service.js";

const env = loadEnv();
const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const workspaceRoot = path.resolve(currentDir, "../../../..");
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const ALLOWED_MIME_PREFIXES = ["image/", "text/"];
const ALLOWED_MIME_TYPES = new Set([
  "application/json",
  "application/pdf",
  "application/octet-stream"
]);

type UploadAttachmentInput = {
  data: string;
  mimeType: string;
  name: string;
  pathId: string;
  size: number;
  source?: "clipboard" | "file";
  userId: string;
};

type CleanupOrphanedUploadsInput = {
  limit?: number;
  olderThanMinutes?: number;
};

let client: S3Client | null = null;

export class MissingR2ConfigError extends Error {
  constructor() {
    super("R2 is not configured. Add R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY to .env, or use ATTACHMENT_STORAGE_PROVIDER=local.");
    this.name = "MissingR2ConfigError";
  }
}

const isConfiguredValue = (value: string | undefined) => {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 && !normalized.toLowerCase().includes("your-");
};

const isR2Configured = () =>
  isConfiguredValue(env.R2_ENDPOINT) &&
  isConfiguredValue(env.R2_BUCKET) &&
  isConfiguredValue(env.R2_ACCESS_KEY_ID) &&
  isConfiguredValue(env.R2_SECRET_ACCESS_KEY);

const getStorageProvider = () => {
  if (env.ATTACHMENT_STORAGE_PROVIDER === "local") {
    return "local";
  }

  if (env.ATTACHMENT_STORAGE_PROVIDER === "r2") {
    if (!isR2Configured()) {
      throw new MissingR2ConfigError();
    }

    return "r2";
  }

  return isR2Configured() ? "r2" : "local";
};

const getClient = () => {
  if (!isR2Configured()) {
    throw new MissingR2ConfigError();
  }

  const r2Endpoint = env.R2_ENDPOINT;
  const r2AccessKeyId = env.R2_ACCESS_KEY_ID;
  const r2SecretAccessKey = env.R2_SECRET_ACCESS_KEY;

  if (!r2Endpoint || !r2AccessKeyId || !r2SecretAccessKey) {
    throw new MissingR2ConfigError();
  }

  client ??= new S3Client({
    credentials: {
      accessKeyId: r2AccessKeyId,
      secretAccessKey: r2SecretAccessKey
    },
    endpoint: r2Endpoint.replace(new RegExp(`/${env.R2_BUCKET}/?$`), ""),
    forcePathStyle: true,
    region: "auto"
  });

  return client;
};

const getLocalUploadRoot = () =>
  path.resolve(workspaceRoot, env.LOCAL_UPLOAD_DIR);

const getLocalUploadPath = (storageKey: string) => {
  const uploadRoot = getLocalUploadRoot();
  const uploadPath = path.resolve(uploadRoot, ...storageKey.split("/"));

  if (uploadPath !== uploadRoot && !uploadPath.startsWith(`${uploadRoot}${path.sep}`)) {
    throw new Error("Invalid attachment storage key.");
  }

  return uploadPath;
};

const isAllowedMimeType = (mimeType: string) =>
  ALLOWED_MIME_TYPES.has(mimeType) ||
  ALLOWED_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix));

const decodePayload = (value: string) => {
  const dataUrlMatch = value.match(/^data:([^;,]+)?;base64,(.+)$/);

  if (dataUrlMatch) {
    return {
      buffer: Buffer.from(dataUrlMatch[2], "base64"),
      mimeType: dataUrlMatch[1] ?? null
    };
  }

  return {
    buffer: Buffer.from(value, "base64"),
    mimeType: null
  };
};

const getPathForUpload = async (pathId: string, userId: string) => {
  return db
    .select({
      conversationId: paths.conversationId,
      pathId: paths.id
    })
    .from(paths)
    .innerJoin(conversations, eq(paths.conversationId, conversations.id))
    .where(and(eq(paths.id, pathId), eq(conversations.userId, userId)))
    .limit(1)
    .then((rows) => rows[0] ?? null);
};

const toAttachmentResponse = (attachment: typeof attachments.$inferSelect) => ({
  id: attachment.id,
  kind: attachment.kind === "image" ? "image" : "file",
  mimeType: attachment.mimeType,
  name: attachment.originalName,
  size: attachment.byteSize,
  sourceUrl: `/attachments/${attachment.id}/content`,
  thumbnailUrl: `/attachments/${attachment.id}/content`
});

export const uploadAttachment = async ({
  data,
  mimeType,
  name,
  pathId,
  size,
  source,
  userId
}: UploadAttachmentInput) => {
  const pathRecord = await getPathForUpload(pathId, userId);

  if (!pathRecord) {
    return null;
  }

  const decoded = decodePayload(data);
  const resolvedMimeType = decoded.mimeType ?? mimeType;

  if (!isAllowedMimeType(resolvedMimeType)) {
    throw new Error("Unsupported attachment type.");
  }

  if (
    decoded.buffer.byteLength <= 0 ||
    decoded.buffer.byteLength > MAX_ATTACHMENT_BYTES ||
    size > MAX_ATTACHMENT_BYTES
  ) {
    throw new Error("Attachment is too large.");
  }

  const attachmentId = crypto.randomUUID();
  const safeName = name.trim() || "attachment";
  const kind = resolvedMimeType.startsWith("image/") ? "image" : "file";
  const storageProvider = getStorageProvider();
  const storageKey = [
    "users",
    userId,
    "conversations",
    pathRecord.conversationId,
    "attachments",
    attachmentId,
    "original"
  ].join("/");

  if (storageProvider === "r2") {
    await getClient().send(
      new PutObjectCommand({
        Body: decoded.buffer,
        Bucket: env.R2_BUCKET,
        ContentLength: decoded.buffer.byteLength,
        ContentType: resolvedMimeType,
        Key: storageKey,
        Metadata: {
          originalName: safeName,
          source: source ?? "file"
        }
      })
    );
  } else {
    const uploadPath = getLocalUploadPath(storageKey);
    await mkdir(path.dirname(uploadPath), { recursive: true });
    await writeFile(uploadPath, decoded.buffer);
  }

  const [attachment] = await db
    .insert(attachments)
    .values({
      byteSize: decoded.buffer.byteLength,
      conversationId: pathRecord.conversationId,
      createdByUserId: userId,
      id: attachmentId,
      kind,
      mimeType: resolvedMimeType,
      originalName: safeName,
      pathId,
      status: "uploaded",
      storageProvider,
      storageKey
    })
    .returning();

  void enqueueEmbeddingForSource({
    sourceId: attachment.id,
    sourceType: "attachment_text"
  }).catch(() => undefined);

  return toAttachmentResponse(attachment);
};

export const getAttachmentForUser = async (attachmentId: string, userId: string) => {
  return db
    .select({
      attachment: attachments
    })
    .from(attachments)
    .innerJoin(conversations, eq(attachments.conversationId, conversations.id))
    .where(and(eq(attachments.id, attachmentId), eq(conversations.userId, userId)))
    .limit(1)
    .then((rows) => rows[0]?.attachment ?? null);
};

export const streamAttachment = async (attachmentId: string, userId: string) => {
  const attachment = await getAttachmentForUser(attachmentId, userId);

  if (!attachment) {
    return null;
  }

  if (attachment.storageProvider === "local") {
    return {
      attachment,
      body: createReadStream(getLocalUploadPath(attachment.storageKey))
    };
  }

  const object = await getClient().send(
    new GetObjectCommand({
      Bucket: env.R2_BUCKET,
      Key: attachment.storageKey
    })
  );

  return {
    attachment,
    body: object.Body instanceof Readable ? object.Body : Readable.from(object.Body as AsyncIterable<Uint8Array>)
  };
};

export const attachUploadedAttachmentsToMessage = async ({
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
    return [];
  }

  const rows = await db
    .update(attachments)
    .set({
      messageId,
      status: "attached",
      updatedAt: new Date()
    })
    .where(
      and(
        inArray(attachments.id, attachmentIds),
        eq(attachments.createdByUserId, userId),
        eq(attachments.pathId, pathId),
        eq(attachments.status, "uploaded")
      )
    )
    .returning();

  return rows.map(toAttachmentResponse);
};

export const cleanupOrphanedUploads = async ({
  limit = 50,
  olderThanMinutes = 60
}: CleanupOrphanedUploadsInput = {}) => {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000);
  const candidates = await db.query.attachments.findMany({
    limit,
    orderBy: [asc(attachments.createdAt)],
    where: and(
      eq(attachments.status, "uploaded"),
      lt(attachments.createdAt, cutoff)
    )
  });

  if (candidates.length === 0) {
    return {
      deleted: 0,
      failed: 0,
      scanned: 0
    };
  }

  let deleted = 0;
  let failed = 0;

  for (const attachment of candidates) {
    try {
      if (attachment.storageProvider === "local") {
        await rm(getLocalUploadPath(attachment.storageKey), { force: true });

        if (attachment.thumbnailStorageKey) {
          await rm(getLocalUploadPath(attachment.thumbnailStorageKey), { force: true });
        }
      } else {
        const storageClient = getClient();
        await storageClient.send(
          new DeleteObjectCommand({
            Bucket: env.R2_BUCKET,
            Key: attachment.storageKey
          })
        );

        if (attachment.thumbnailStorageKey) {
          await storageClient.send(
            new DeleteObjectCommand({
              Bucket: env.R2_BUCKET,
              Key: attachment.thumbnailStorageKey
            })
          );
        }
      }

      await db.delete(attachments).where(eq(attachments.id, attachment.id));
      deleted += 1;
    } catch {
      failed += 1;
      await db
        .update(attachments)
        .set({
          status: "cleanup_failed",
          updatedAt: new Date()
        })
        .where(eq(attachments.id, attachment.id));
    }
  }

  return {
    deleted,
    failed,
    scanned: candidates.length
  };
};
