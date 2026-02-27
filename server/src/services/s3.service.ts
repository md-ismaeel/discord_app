import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createApiError } from "../utils/ApiError.js";
import { HTTP_STATUS } from "../constants/httpStatus.js";
import { getEnv } from "../config/env.config.js";
import crypto from "crypto";
import path from "path";

// ============================================================================
// S3 CLIENT CONFIGURATION
// ============================================================================

const s3Client = new S3Client({
  region: getEnv("AWS_REGION"),
  credentials: {
    accessKeyId: getEnv("AWS_ACCESS_KEY_ID"),
    secretAccessKey: getEnv("AWS_SECRET_ACCESS_KEY"),
  },
});

const BUCKET_NAME = getEnv("AWS_BUCKET_NAME");
const CDN_URL = getEnv("AWS_CLOUDFRONT_URL") || null; // Optional CloudFront CDN

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate unique filename
 * @param {String} originalName - Original filename
 * @param {String} prefix - Optional prefix
 * @returns {String} - Unique filename
 */
const generateUniqueFilename = (originalName, prefix = "") => {
  const timestamp = Date.now();
  const randomString = crypto.randomBytes(8).toString("hex");
  const ext = path.extname(originalName);
  const name = path.basename(originalName, ext).replace(/[^a-zA-Z0-9]/g, "-");

  return `${prefix}${timestamp}-${randomString}-${name}${ext}`;
};

/**
 * Get file URL (with CDN if configured)
 * @param {String} key - S3 object key
 * @returns {String} - File URL
 */
const getFileUrl = (key) => {
  if (CDN_URL) {
    return `${CDN_URL}/${key}`;
  }
  return `https://${BUCKET_NAME}.s3.${getEnv("AWS_REGION")}.amazonaws.com/${key}`;
};

/**
 * Get content type from file extension
 * @param {String} filename - Filename
 * @returns {String} - Content type
 */
const getContentType = (filename) => {
  const ext = path.extname(filename).toLowerCase();
  const contentTypes = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx":
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".txt": "text/plain",
    ".zip": "application/zip",
    ".rar": "application/x-rar-compressed",
  };
  return contentTypes[ext] || "application/octet-stream";
};

// ============================================================================
// UPLOAD FUNCTIONS
// ============================================================================

/**
 * Upload file to S3
 * @param {Buffer} fileBuffer - File buffer
 * @param {String} key - S3 object key (path)
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} - Upload result
 */
const uploadToS3 = async (fileBuffer, key, options = {}) => {
  try {
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: fileBuffer,
      ContentType: options.contentType || getContentType(key),
      ACL: options.acl || "public-read",
      Metadata: options.metadata || {},
      CacheControl: options.cacheControl || "max-age=31536000", // 1 year
    });

    await s3Client.send(command);

    return {
      key,
      url: getFileUrl(key),
      bucket: BUCKET_NAME,
      size: fileBuffer.length,
    };
  } catch (error) {
    console.error("S3 upload error:", error);
    throw createApiError(
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      "Failed to upload file to S3",
    );
  }
};

/**
 * Upload user avatar
 * @param {Buffer} fileBuffer - Image buffer
 * @param {String} userId - User ID
 * @param {String} originalName - Original filename
 * @returns {Promise<Object>} - { url, key, size }
 */
export const uploadAvatar = async (fileBuffer, userId, originalName) => {
  const filename = generateUniqueFilename(originalName, "avatar-");
  const key = `avatars/${userId}/${filename}`;

  const result = await uploadToS3(fileBuffer, key, {
    contentType: getContentType(originalName),
    metadata: {
      userId,
      type: "avatar",
    },
  });

  return {
    url: result.url,
    key: result.key,
    size: result.size,
  };
};

/**
 * Upload server icon
 * @param {Buffer} fileBuffer - Image buffer
 * @param {String} serverId - Server ID
 * @param {String} originalName - Original filename
 * @returns {Promise<Object>} - { url, key, size }
 */
export const uploadServerIcon = async (fileBuffer, serverId, originalName) => {
  const filename = generateUniqueFilename(originalName, "icon-");
  const key = `servers/${serverId}/icon/${filename}`;

  const result = await uploadToS3(fileBuffer, key, {
    contentType: getContentType(originalName),
    metadata: {
      serverId,
      type: "server-icon",
    },
  });

  return {
    url: result.url,
    key: result.key,
    size: result.size,
  };
};

/**
 * Upload server banner
 * @param {Buffer} fileBuffer - Image buffer
 * @param {String} serverId - Server ID
 * @param {String} originalName - Original filename
 * @returns {Promise<Object>} - { url, key, size }
 */
export const uploadServerBanner = async (
  fileBuffer,
  serverId,
  originalName,
) => {
  const filename = generateUniqueFilename(originalName, "banner-");
  const key = `servers/${serverId}/banner/${filename}`;

  const result = await uploadToS3(fileBuffer, key, {
    contentType: getContentType(originalName),
    metadata: {
      serverId,
      type: "server-banner",
    },
  });

  return {
    url: result.url,
    key: result.key,
    size: result.size,
  };
};

/**
 * Upload message attachment
 * @param {Buffer} fileBuffer - File buffer
 * @param {String} channelId - Channel ID
 * @param {String} originalName - Original filename
 * @returns {Promise<Object>} - { url, key, filename, size, type }
 */
export const uploadMessageAttachment = async (
  fileBuffer,
  channelId,
  originalName,
) => {
  const filename = generateUniqueFilename(originalName);
  const key = `messages/${channelId}/${filename}`;

  const result = await uploadToS3(fileBuffer, key, {
    contentType: getContentType(originalName),
    metadata: {
      channelId,
      originalName,
      type: "message-attachment",
    },
  });

  return {
    url: result.url,
    key: result.key,
    filename: originalName,
    size: result.size,
    type: path.extname(originalName).substring(1),
  };
};

/**
 * Upload custom emoji
 * @param {Buffer} fileBuffer - Image buffer
 * @param {String} serverId - Server ID
 * @param {String} emojiName - Emoji name
 * @param {String} originalName - Original filename
 * @returns {Promise<Object>} - { url, key }
 */
export const uploadCustomEmoji = async (
  fileBuffer,
  serverId,
  emojiName,
  originalName,
) => {
  const ext = path.extname(originalName);
  const key = `servers/${serverId}/emojis/${emojiName}${ext}`;

  const result = await uploadToS3(fileBuffer, key, {
    contentType: getContentType(originalName),
    metadata: {
      serverId,
      emojiName,
      type: "custom-emoji",
    },
  });

  return {
    url: result.url,
    key: result.key,
  };
};

// ============================================================================
// BATCH OPERATIONS
// ============================================================================

/**
 * Upload multiple message attachments
 * @param {Array} files - Array of multer files
 * @param {String} channelId - Channel ID
 * @returns {Promise<Array>} - Array of upload results
 */
export const uploadMultipleAttachments = async (files, channelId) => {
  try {
    const uploadPromises = files.map((file) =>
      uploadMessageAttachment(file.buffer, channelId, file.originalname),
    );

    const results = await Promise.all(uploadPromises);
    return results;
  } catch (error) {
    throw error;
  }
};

// ============================================================================
// DELETE FUNCTIONS
// ============================================================================

/**
 * Delete file from S3
 * @param {String} key - S3 object key
 * @returns {Promise<Object>} - Deletion result
 */
export const deleteFromS3 = async (key) => {
  try {
    const command = new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    await s3Client.send(command);

    return { success: true, key };
  } catch (error) {
    console.error("S3 delete error:", error);
    throw createApiError(
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      "Failed to delete file from S3",
    );
  }
};

/**
 * Delete multiple files from S3
 * @param {Array} keys - Array of S3 object keys
 * @returns {Promise<Object>} - Deletion results
 */
export const deleteMultipleFiles = async (keys) => {
  try {
    const command = new DeleteObjectsCommand({
      Bucket: BUCKET_NAME,
      Delete: {
        Objects: keys.map((key) => ({ Key: key })),
      },
    });

    const result = await s3Client.send(command);

    return {
      deleted: result.Deleted || [],
      errors: result.Errors || [],
    };
  } catch (error) {
    console.error("S3 batch delete error:", error);
    throw createApiError(
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      "Failed to delete files from S3",
    );
  }
};

/**
 * Extract S3 key from URL
 * @param {String} url - S3 or CloudFront URL
 * @returns {String|null} - S3 key or null
 */
export const extractKeyFromUrl = (url) => {
  if (!url) return null;

  try {
    // Handle CloudFront URLs
    if (CDN_URL && url.startsWith(CDN_URL)) {
      return url.replace(`${CDN_URL}/`, "");
    }

    // Handle S3 URLs
    const s3UrlPattern = new RegExp(
      `https://${BUCKET_NAME}\\.s3\\.${getEnv("AWS_REGION")}\\.amazonaws\\.com/(.+)`,
    );
    const match = url.match(s3UrlPattern);

    if (match) {
      return decodeURIComponent(match[1]);
    }

    return null;
  } catch (error) {
    console.error("Error extracting S3 key:", error);
    return null;
  }
};

// ============================================================================
// PRESIGNED URLs (For Private Files)
// ============================================================================

/**
 * Generate presigned URL for temporary access to private files
 * @param {String} key - S3 object key
 * @param {Number} expiresIn - Expiration time in seconds (default: 1 hour)
 * @returns {Promise<String>} - Presigned URL
 */
export const generatePresignedUrl = async (key, expiresIn = 3600) => {
  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    const url = await getSignedUrl(s3Client, command, { expiresIn });
    return url;
  } catch (error) {
    console.error("Error generating presigned URL:", error);
    throw createApiError(
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      "Failed to generate presigned URL",
    );
  }
};

/**
 * Generate presigned upload URL (for direct browser uploads)
 * @param {String} key - S3 object key
 * @param {String} contentType - File content type
 * @param {Number} expiresIn - Expiration time in seconds (default: 15 minutes)
 * @returns {Promise<Object>} - { url, key }
 */
export const generatePresignedUploadUrl = async (
  key,
  contentType,
  expiresIn = 900,
) => {
  try {
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      ContentType: contentType,
    });

    const url = await getSignedUrl(s3Client, command, { expiresIn });

    return {
      url,
      key,
      expiresIn,
    };
  } catch (error) {
    console.error("Error generating presigned upload URL:", error);
    throw createApiError(
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      "Failed to generate presigned upload URL",
    );
  }
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Check if file exists in S3
 * @param {String} key - S3 object key
 * @returns {Promise<Boolean>} - True if exists
 */
export const fileExists = async (key) => {
  try {
    const command = new HeadObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    await s3Client.send(command);
    return true;
  } catch (error) {
    if (error.name === "NotFound") {
      return false;
    }
    throw error;
  }
};

/**
 * Get file metadata
 * @param {String} key - S3 object key
 * @returns {Promise<Object>} - File metadata
 */
export const getFileMetadata = async (key) => {
  try {
    const command = new HeadObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    const response = await s3Client.send(command);

    return {
      contentType: response.ContentType,
      contentLength: response.ContentLength,
      lastModified: response.LastModified,
      metadata: response.Metadata,
      etag: response.ETag,
    };
  } catch (error) {
    console.error("Error getting file metadata:", error);
    throw createApiError(HTTP_STATUS.NOT_FOUND, "File not found in S3");
  }
};

/**
 * Copy file within S3
 * @param {String} sourceKey - Source S3 key
 * @param {String} destinationKey - Destination S3 key
 * @returns {Promise<Object>} - Copy result
 */
export const copyFile = async (sourceKey, destinationKey) => {
  try {
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: destinationKey,
      CopySource: `${BUCKET_NAME}/${sourceKey}`,
    });

    await s3Client.send(command);

    return {
      sourceKey,
      destinationKey,
      url: getFileUrl(destinationKey),
    };
  } catch (error) {
    console.error("Error copying file in S3:", error);
    throw createApiError(
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      "Failed to copy file in S3",
    );
  }
};

// ============================================================================
// EXPORTS
// ============================================================================

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
