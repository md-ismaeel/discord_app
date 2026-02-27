import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  CopyObjectCommand,          // FIX: original used PutObjectCommand for copies — wrong command
  type ObjectCannedACL,
  type HeadObjectCommandOutput,
  type DeletedObject,
  type Error as S3Error,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ApiError } from "../utils/ApiError.js";
import { getEnv } from "../config/env.config.js";
import crypto from "crypto";
import path from "path";

// ─── Return-type interfaces ───────────────────────────────────────────────────

export interface S3UploadResult {
  /** Full public URL (CloudFront or direct S3) */
  url: string;
  /** S3 object key — store this for deletion */
  key: string;
  /** File size in bytes */
  size: number;
}

export interface S3AttachmentResult extends S3UploadResult {
  /** Original filename (for display in chat) */
  filename: string;
  /** File extension without the dot, e.g. "pdf" */
  type: string;
}

export interface S3EmojiResult {
  url: string;
  key: string;
}

export interface S3DeleteResult {
  success: true;
  key: string;
}

export interface S3BatchDeleteResult {
  deleted: DeletedObject[];
  errors: S3Error[];
}

export interface S3FileMetadata {
  contentType?: string;
  contentLength?: number;
  lastModified?: Date;
  metadata?: Record<string, string>;
  etag?: string;
}

export interface S3PresignedUploadResult {
  url: string;
  key: string;
  expiresIn: number;
}

export interface S3CopyResult {
  sourceKey: string;
  destinationKey: string;
  url: string;
}

// ─── Upload options ───────────────────────────────────────────────────────────

interface UploadOptions {
  contentType?: string;
  acl?: ObjectCannedACL;
  metadata?: Record<string, string>;
  cacheControl?: string;
}

// ─── S3 Client ────────────────────────────────────────────────────────────────

const s3Client = new S3Client({
  region: getEnv("AWS_REGION"),
  credentials: {
    accessKeyId: getEnv("AWS_ACCESS_KEY_ID"),
    secretAccessKey: getEnv("AWS_SECRET_ACCESS_KEY"),
  },
});

const BUCKET_NAME: string = getEnv("AWS_BUCKET_NAME");
// Trim trailing slash from CDN_URL so `${CDN_URL}/${key}` is always clean
const CDN_URL: string | null =
  (getEnv("AWS_CLOUDFRONT_URL") || "").replace(/\/$/, "") || null;

// ─── Private helpers ──────────────────────────────────────────────────────────

/**
 * Build a unique filename that is safe for S3 keys.
 * Format: `{prefix}{timestamp}-{8-byte-hex}-{sanitised-name}{ext}`
 */
const generateUniqueFilename = (originalName: string, prefix = ""): string => {
  const timestamp = Date.now();
  const random = crypto.randomBytes(8).toString("hex");
  const ext = path.extname(originalName);
  const base = path
    .basename(originalName, ext)
    .replace(/[^a-zA-Z0-9]/g, "-")
    .slice(0, 60); // Prevent excessively long keys

  return `${prefix}${timestamp}-${random}-${base}${ext}`;
};

/**
 * Build the public URL for an S3 key, using CloudFront if configured.
 */
const getFileUrl = (key: string): string =>
  CDN_URL
    ? `${CDN_URL}/${key}`
    : `https://${BUCKET_NAME}.s3.${getEnv("AWS_REGION")}.amazonaws.com/${key}`;

/** Map common file extensions to MIME types. Falls back to octet-stream. */
const getContentType = (filename: string): string => {
  const MIME_MAP: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".txt": "text/plain",
    ".zip": "application/zip",
    ".rar": "application/x-rar-compressed",
  };
  return MIME_MAP[path.extname(filename).toLowerCase()] ?? "application/octet-stream";
};

// ─── Core upload ──────────────────────────────────────────────────────────────

/**
 * Upload a Buffer to S3 at the given key.
 * All public upload helpers delegate here.
 */
const uploadToS3 = async (
  fileBuffer: Buffer,
  key: string,
  options: UploadOptions = {},
): Promise<S3UploadResult> => {
  try {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        Body: fileBuffer,
        ContentType: options.contentType ?? getContentType(key),
        ACL: options.acl ?? "public-read",
        Metadata: options.metadata ?? {},
        CacheControl: options.cacheControl ?? "max-age=31536000", // 1 year
      }),
    );

    return { key, url: getFileUrl(key), size: fileBuffer.length };
  } catch (err) {
    console.error("S3 upload error:", err);
    throw ApiError.internal("Failed to upload file to S3.");
  }
};

// ─── Upload helpers ───────────────────────────────────────────────────────────

/** Upload a user avatar. Returns `{ url, key, size }`. */
export const uploadAvatar = async (
  fileBuffer: Buffer,
  userId: string,
  originalName: string,
): Promise<S3UploadResult> => {
  const key = `avatars/${userId}/${generateUniqueFilename(originalName, "avatar-")}`;
  return uploadToS3(fileBuffer, key, {
    contentType: getContentType(originalName),
    metadata: { userId, type: "avatar" },
  });
};

/** Upload a server icon. Returns `{ url, key, size }`. */
export const uploadServerIcon = async (
  fileBuffer: Buffer,
  serverId: string,
  originalName: string,
): Promise<S3UploadResult> => {
  const key = `servers/${serverId}/icon/${generateUniqueFilename(originalName, "icon-")}`;
  return uploadToS3(fileBuffer, key, {
    contentType: getContentType(originalName),
    metadata: { serverId, type: "server-icon" },
  });
};

/** Upload a server banner. Returns `{ url, key, size }`. */
export const uploadServerBanner = async (
  fileBuffer: Buffer,
  serverId: string,
  originalName: string,
): Promise<S3UploadResult> => {
  const key = `servers/${serverId}/banner/${generateUniqueFilename(originalName, "banner-")}`;
  return uploadToS3(fileBuffer, key, {
    contentType: getContentType(originalName),
    metadata: { serverId, type: "server-banner" },
  });
};

/** Upload a message attachment (image or file). Returns full attachment metadata. */
export const uploadMessageAttachment = async (
  fileBuffer: Buffer,
  channelId: string,
  originalName: string,
): Promise<S3AttachmentResult> => {
  const key = `messages/${channelId}/${generateUniqueFilename(originalName)}`;
  const result = await uploadToS3(fileBuffer, key, {
    contentType: getContentType(originalName),
    metadata: { channelId, originalName, type: "message-attachment" },
  });

  return {
    ...result,
    filename: originalName,
    type: path.extname(originalName).replace(".", ""),
  };
};

/** Upload a custom server emoji. Returns `{ url, key }`. */
export const uploadCustomEmoji = async (
  fileBuffer: Buffer,
  serverId: string,
  emojiName: string,
  originalName: string,
): Promise<S3EmojiResult> => {
  const ext = path.extname(originalName);
  const key = `servers/${serverId}/emojis/${emojiName}${ext}`;
  const result = await uploadToS3(fileBuffer, key, {
    contentType: getContentType(originalName),
    metadata: { serverId, emojiName, type: "custom-emoji" },
  });
  return { url: result.url, key: result.key };
};

// ─── Batch upload ─────────────────────────────────────────────────────────────

/**
 * Upload multiple multer files as message attachments concurrently.
 * FIX: original had a pointless try/catch that only re-threw — removed.
 */
export const uploadMultipleAttachments = (
  files: Express.Multer.File[],
  channelId: string,
): Promise<S3AttachmentResult[]> =>
  Promise.all(
    files.map((f) => uploadMessageAttachment(f.buffer, channelId, f.originalname)),
  );

// ─── Delete helpers ───────────────────────────────────────────────────────────

/** Delete one object from S3 by key. */
export const deleteFromS3 = async (key: string): Promise<S3DeleteResult> => {
  try {
    await s3Client.send(
      new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: key }),
    );
    return { success: true, key };
  } catch (err) {
    console.error("S3 delete error:", err);
    throw ApiError.internal("Failed to delete file from S3.");
  }
};

/** Delete multiple objects in a single S3 request. */
export const deleteMultipleFiles = async (
  keys: string[],
): Promise<S3BatchDeleteResult> => {
  try {
    const result = await s3Client.send(
      new DeleteObjectsCommand({
        Bucket: BUCKET_NAME,
        Delete: { Objects: keys.map((Key) => ({ Key })) },
      }),
    );
    return {
      deleted: result.Deleted ?? [],
      errors: result.Errors ?? [],
    };
  } catch (err) {
    console.error("S3 batch delete error:", err);
    throw ApiError.internal("Failed to delete files from S3.");
  }
};

// ─── URL utilities ────────────────────────────────────────────────────────────

/**
 * Extract the S3 object key from a public URL (CloudFront or direct S3).
 * Returns `null` if the URL doesn't match either pattern.
 */
export const extractKeyFromUrl = (url: string): string | null => {
  if (!url) return null;

  try {
    if (CDN_URL && url.startsWith(CDN_URL)) {
      return url.slice(CDN_URL.length + 1); // +1 for the trailing "/"
    }

    const pattern = new RegExp(
      `^https://${BUCKET_NAME}\\.s3\\.${getEnv("AWS_REGION")}\\.amazonaws\\.com/(.+)$`,
    );
    const match = url.match(pattern);
    return match ? decodeURIComponent(match[1]) : null;
  } catch (err) {
    console.error("Error extracting S3 key:", err);
    return null;
  }
};

// ─── Presigned URLs ───────────────────────────────────────────────────────────

/**
 * Generate a short-lived download URL for a private file.
 * @param expiresIn - TTL in seconds (default 1 hour)
 */
export const generatePresignedUrl = async (
  key: string,
  expiresIn = 3_600,
): Promise<string> => {
  try {
    return await getSignedUrl(
      s3Client,
      new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key }),
      { expiresIn },
    );
  } catch (err) {
    console.error("Error generating presigned URL:", err);
    throw ApiError.internal("Failed to generate presigned URL.");
  }
};

/**
 * Generate a short-lived upload URL for direct browser-to-S3 uploads.
 * @param expiresIn - TTL in seconds (default 15 minutes)
 */
export const generatePresignedUploadUrl = async (
  key: string,
  contentType: string,
  expiresIn = 900,
): Promise<S3PresignedUploadResult> => {
  try {
    const url = await getSignedUrl(
      s3Client,
      new PutObjectCommand({ Bucket: BUCKET_NAME, Key: key, ContentType: contentType }),
      { expiresIn },
    );
    return { url, key, expiresIn };
  } catch (err) {
    console.error("Error generating presigned upload URL:", err);
    throw ApiError.internal("Failed to generate presigned upload URL.");
  }
};

// ─── Utility helpers ──────────────────────────────────────────────────────────

/**
 * Check whether a key exists in S3 without downloading the object.
 * Uses HeadObject which is billed as a GET but returns no body.
 */
export const fileExists = async (key: string): Promise<boolean> => {
  try {
    await s3Client.send(
      new HeadObjectCommand({ Bucket: BUCKET_NAME, Key: key }),
    );
    return true;
  } catch (err: unknown) {
    // AWS SDK v3 throws NotFound (404) for missing objects
    if ((err as { name?: string }).name === "NotFound") return false;
    throw err;
  }
};

/** Return metadata for an S3 object (content type, size, last modified, etc.). */
export const getFileMetadata = async (key: string): Promise<S3FileMetadata> => {
  try {
    const res: HeadObjectCommandOutput = await s3Client.send(
      new HeadObjectCommand({ Bucket: BUCKET_NAME, Key: key }),
    );
    return {
      contentType: res.ContentType,
      contentLength: res.ContentLength,
      lastModified: res.LastModified,
      metadata: res.Metadata,
      etag: res.ETag,
    };
  } catch (err) {
    console.error("Error getting S3 file metadata:", err);
    throw ApiError.notFound("File not found in S3.");
  }
};

/**
 * Copy an object within the same S3 bucket.
 * FIX: original used PutObjectCommand with a CopySource header — that is not
 * how the AWS SDK v3 copies work. The correct command is CopyObjectCommand.
 */
export const copyFile = async (
  sourceKey: string,
  destinationKey: string,
): Promise<S3CopyResult> => {
  try {
    await s3Client.send(
      new CopyObjectCommand({
        Bucket: BUCKET_NAME,
        Key: destinationKey,
        CopySource: `${BUCKET_NAME}/${sourceKey}`,
      }),
    );
    return { sourceKey, destinationKey, url: getFileUrl(destinationKey) };
  } catch (err) {
    console.error("Error copying S3 file:", err);
    throw ApiError.internal("Failed to copy file in S3.");
  }
};

// ─── Default export (for convenience) ────────────────────────────────────────

export default {
  uploadAvatar,
  uploadServerIcon,
  uploadServerBanner,
  uploadMessageAttachment,
  uploadCustomEmoji,
  uploadMultipleAttachments,
  deleteFromS3,
  deleteMultipleFiles,
  extractKeyFromUrl,
  generatePresignedUrl,
  generatePresignedUploadUrl,
  fileExists,
  getFileMetadata,
  copyFile,
};