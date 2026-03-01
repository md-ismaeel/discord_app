import {
    // FIX: original used PutObjectCommand for copies — wrong command
    type ObjectCannedACL,
    type DeletedObject,
    type Error as S3Error,
} from "@aws-sdk/client-s3";

//  Return-type interfaces
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

//  Upload options
export interface UploadOptions {
    contentType?: string;
    acl?: ObjectCannedACL;
    metadata?: Record<string, string>;
    cacheControl?: string;
}