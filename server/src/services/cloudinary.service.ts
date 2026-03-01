import { v2 as cloudinary, type UploadApiOptions, type UploadApiResponse } from "cloudinary";
import { ApiError } from "@/utils/ApiError";
import { getEnv } from "@/config/env.config";
import { CloudinaryUploadResult, CloudinaryFileUploadResult, CloudinaryImageUploadResult } from "@/types/cloudinary";

//  Configuration 
// Called once at module load. Throws immediately if any env var is missing.

cloudinary.config({
  cloud_name: getEnv("CLOUDINARY_CLOUD_NAME"),
  api_key: getEnv("CLOUDINARY_API_KEY"),
  api_secret: getEnv("CLOUDINARY_API_SECRET"),
  secure: true, // Always use HTTPS URLs
});


//  Core upload helper 
// Wraps the callback-based upload_stream in a Promise.
// FIX: was (fileBuffer, options = {}) with no types — fileBuffer could be anything.

const uploadToCloudinary = (fileBuffer: Buffer, options: UploadApiOptions = {}): Promise<UploadApiResponse> => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { resource_type: "auto", ...options },
      (error, result) => {
        if (error || !result) {
          console.error("Cloudinary upload error:", error);
          reject(
            ApiError.internal("Failed to upload file to cloud storage."),
          );
        } else {
          resolve(result);
        }
      },
    );
    stream.end(fileBuffer);
  });
};

//  Avatar 

/**
 * Upload a user avatar.
 * Resized to 256×256, face-cropped, format-optimised.
 */
export const uploadAvatarToCloud = async (fileBuffer: Buffer, userId: string): Promise<CloudinaryUploadResult> => {
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

  return { url: result.secure_url, publicId: result.public_id };
};

//  Server icon 

/**
 * Upload a server icon.
 * Resized to 512×512, square-cropped.
 */
export const uploadServerIconToCloud = async (fileBuffer: Buffer, serverId: string): Promise<CloudinaryUploadResult> => {
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

  return { url: result.secure_url, publicId: result.public_id };
};

//  Server banner 

/**
 * Upload a server banner.
 * Resized to 1920×480 (standard widescreen banner ratio).
 */
export const uploadServerBannerToCloud = async (fileBuffer: Buffer, serverId: string): Promise<CloudinaryUploadResult> => {
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

  return { url: result.secure_url, publicId: result.public_id };
};

//  Message image attachment 

/**
 * Upload an image sent as a message attachment.
 * Capped at 1920×1920 (preserves aspect ratio via "limit").
 */
export const uploadMessageImageToCloud = async (fileBuffer: Buffer, channelId: string): Promise<CloudinaryImageUploadResult> => {
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

//  Message file attachment (raw) 

/**
 * Upload a non-image file (PDF, DOCX, ZIP, etc.) as a message attachment.
 * Uses resource_type "raw" — Cloudinary does not transform these.
 */
export const uploadMessageFileToCloud = async (fileBuffer: Buffer, channelId: string, filename: string): Promise<CloudinaryFileUploadResult> => {
  // Sanitise the filename for use as a Cloudinary public_id
  const safeFilename = filename.replace(/[^a-zA-Z0-9.-]/g, "_");

  const result = await uploadToCloudinary(fileBuffer, {
    folder: `discord-clone/messages/${channelId}`,
    resource_type: "raw",
    public_id: `${Date.now()}-${safeFilename}`,
  });

  return {
    url: result.secure_url,
    publicId: result.public_id,
    filename,
    size: result.bytes,
  };
};

//  Custom emoji 

/**
 * Upload a custom server emoji.
 * Resized to 128×128 with "fit" crop (preserves aspect ratio).
 */
export const uploadCustomEmojiToCloud = async (fileBuffer: Buffer, serverId: string, emojiName: string): Promise<CloudinaryUploadResult> => {
  const result = await uploadToCloudinary(fileBuffer, {
    folder: `discord-clone/servers/${serverId}/emojis`,
    public_id: emojiName,
    transformation: [
      { width: 128, height: 128, crop: "fit" },
      { quality: "auto:best" },
    ],
    overwrite: true,
  });

  return { url: result.secure_url, publicId: result.public_id };
};

//  Delete single 

/**
 * Delete one asset from Cloudinary by its public_id.
 * @param resourceType - "image" | "video" | "raw" (default "image")
 */
export const deleteFromCloudinary = async (publicId: string, resourceType: "image" | "video" | "raw" = "image"): Promise<{ result: string }> => {
  try {
    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType,
    });
    return result as { result: string };
  } catch (err) {
    console.error("Cloudinary delete error:", err);
    throw ApiError.internal("Failed to delete file from cloud storage.");
  }
};

//  Delete multiple 

/**
 * Delete multiple assets in a single API call.
 * Cloudinary's API accepts up to 100 public_ids per request.
 */
export const deleteMultipleFromCloudinary = async (publicIds: string[], resourceType: "image" | "video" | "raw" = "image"): Promise<Record<string, string>> => {
  try {
    const result = await cloudinary.api.delete_resources(publicIds, {
      resource_type: resourceType,
    });
    return result as Record<string, string>;
  } catch (err) {
    console.error("Cloudinary batch delete error:", err);
    throw ApiError.internal("Failed to delete files from cloud storage.");
  }
};