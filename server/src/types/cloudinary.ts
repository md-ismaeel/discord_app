
// interfaces
export interface CloudinaryUploadResult {
    /** Public HTTPS URL */
    url: string;
    /** Cloudinary public_id — store this for later deletion */
    publicId: string;
}

export interface CloudinaryFileUploadResult extends CloudinaryUploadResult {
    /** Original filename (preserved for display in chat) */
    filename: string;
    /** File size in bytes */
    size: number;
}

export interface CloudinaryImageUploadResult extends CloudinaryUploadResult {
    /** File size in bytes */
    size: number;
}