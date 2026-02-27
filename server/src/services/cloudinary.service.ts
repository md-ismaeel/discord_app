import { v2 as cloudinary } from "cloudinary";
import { createApiError } from "../utils/ApiError.js";
import { HTTP_STATUS } from "../constants/httpStatus.js";
import { getEnv } from "../config/env.config.js";

// ============================================================================
// CLOUDINARY CONFIGURATION
// ============================================================================
cloudinary.config({
  cloud_name: getEnv("CLOUDINARY_CLOUD_NAME"),
  api_key: getEnv("CLOUDINARY_API_KEY"),
  api_secret: getEnv("CLOUDINARY_API_SECRET"),
});

// ============================================================================
// CORE UPLOAD FUNCTION
// ============================================================================
/**
 * Upload a file buffer to Cloudinary
 * @param {Buffer} fileBuffer - File buffer from multer (req.file.buffer)
 * @param {Object} options - Cloudinary upload options
 * @returns {Promise<Object>} Upload result with url, publicId, etc.
 */
const uploadToCloudinary = (fileBuffer, options = {}) => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: "auto",
        ...options,
      },
      (error, result) => {
        if (error) {
          console.error("Cloudinary upload error:", error);
          reject(
            createApiError(
              HTTP_STATUS.INTERNAL_SERVER_ERROR,
              "Failed to upload file to cloud storage",
            ),
          );
        } else {
          resolve(result);
        }
      },
    );
    uploadStream.end(fileBuffer);
  });
};

// ============================================================================
// SPECIFIC UPLOAD FUNCTIONS
// Each function handles a specific use case with appropriate settings
// ============================================================================

/**
 * Upload user avatar (256x256, optimized for profile pictures)
 */
export const uploadAvatarToCloud = async (fileBuffer, userId) => {
  const result = await uploadToCloudinary(fileBuffer, {
    folder: `discord-clone/avatars/${userId}`,
    transformation: [
      { width: 256, height: 256, crop: "fill", gravity: "face" },
      { quality: "auto:good" },
      { fetch_format: "auto" },
    ],
    overwrite: true,
    invalidate: true,
  });

  return {
    url: result.secure_url,
    publicId: result.public_id,
  };
};

/**
 * Upload server icon (512x512)
 */
export const uploadServerIconToCloud = async (fileBuffer, serverId) => {
  const result = await uploadToCloudinary(fileBuffer, {
    folder: `discord-clone/servers/${serverId}/icon`,
    transformation: [
      { width: 512, height: 512, crop: "fill" },
      { quality: "auto:good" },
      { fetch_format: "auto" },
    ],
    overwrite: true,
    invalidate: true,
  });

  return {
    url: result.secure_url,
    publicId: result.public_id,
  };
};

/**
 * Upload server banner (1920x480)
 */
export const uploadServerBannerToCloud = async (fileBuffer, serverId) => {
  const result = await uploadToCloudinary(fileBuffer, {
    folder: `discord-clone/servers/${serverId}/banner`,
    transformation: [
      { width: 1920, height: 480, crop: "fill" },
      { quality: "auto:good" },
      { fetch_format: "auto" },
    ],
    overwrite: true,
    invalidate: true,
  });

  return {
    url: result.secure_url,
    publicId: result.public_id,
  };
};

/**
 * Upload message image attachment
 */
export const uploadMessageImageToCloud = async (fileBuffer, channelId) => {
  const result = await uploadToCloudinary(fileBuffer, {
    folder: `discord-clone/messages/${channelId}`,
    resource_type: "image",
    transformation: [
      { width: 1920, height: 1920, crop: "limit" },
      { quality: "auto:good" },
      { fetch_format: "auto" },
    ],
  });

  return {
    url: result.secure_url,
    publicId: result.public_id,
    size: result.bytes,
  };
};

/**
 * Upload message file attachment (PDFs, docs, etc.)
 */
export const uploadMessageFileToCloud = async (fileBuffer, channelId, filename) => {
  const result = await uploadToCloudinary(fileBuffer, {
    folder: `discord-clone/messages/${channelId}`,
    resource_type: "raw",
    public_id: `${Date.now()}-${filename.replace(/[^a-zA-Z0-9.-]/g, "_")}`,
  });

  return {
    url: result.secure_url,
    publicId: result.public_id,
    filename: filename,
    size: result.bytes,
  };
};

/**
 * Upload custom emoji (128x128)
 */
export const uploadCustomEmojiToCloud = async (fileBuffer, serverId, emojiName) => {
  const result = await uploadToCloudinary(fileBuffer, {
    folder: `discord-clone/servers/${serverId}/emojis`,
    public_id: emojiName,
    transformation: [
      { width: 128, height: 128, crop: "fit" },
      { quality: "auto:best" },
    ],
    overwrite: true,
  });

  return {
    url: result.secure_url,
    publicId: result.public_id,
  };
};

// ============================================================================
// DELETE FUNCTIONS
// ============================================================================

/**
 * Delete a file from Cloudinary using its public ID
 */
export const deleteFromCloudinary = async (publicId, resourceType = "image") => {
  try {
    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType,
    });
    return result;
  } catch (error) {
    console.error("Cloudinary delete error:", error);
    throw createApiError(
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      "Failed to delete file from cloud storage",
    );
  }
};

/**
 * Delete multiple files at once
 */
export const deleteMultipleFromCloudinary = async (publicIds) => {
  try {
    const result = await cloudinary.api.delete_resources(publicIds);
    return result;
  } catch (error) {
    console.error("Cloudinary batch delete error:", error);
    throw createApiError(
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      "Failed to delete files from cloud storage",
    );
  }
};