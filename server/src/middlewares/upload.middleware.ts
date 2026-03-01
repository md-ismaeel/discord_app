import type { Request, Response, NextFunction } from "express";
import multer, { type FileFilterCallback } from "multer";
import path from "path";
import { ApiError } from "../utils/ApiError.js";
import { HTTP_STATUS } from "../constants/httpStatus.js";

//  Types
type MulterFileFilter = (req: Request, file: Express.Multer.File, cb: FileFilterCallback,) => void;

//  File filters
/** Accept only web-safe images: jpeg, jpg, png, gif, webp */
const imageFilter: MulterFileFilter = (_req, file, cb) => {
  const allowed = /^image\/(jpeg|jpg|png|gif|webp)$/i;
  const extAllowed = /\.(jpeg|jpg|png|gif|webp)$/i;

  // Check BOTH mimetype AND extension — prevents spoofed MIME types
  if (allowed.test(file.mimetype) && extAllowed.test(file.originalname)) {
    cb(null, true);
  } else {
    cb(
      ApiError.badRequest(
        "Only image files are allowed (jpeg, jpg, png, gif, webp).",
      ),
    );
  }
};

/** Accept images and common document/archive types */
const fileFilter: MulterFileFilter = (_req, file, cb) => {
  const extAllowed = /\.(jpeg|jpg|png|gif|webp|pdf|doc|docx|txt|zip|rar)$/i;

  if (extAllowed.test(path.extname(file.originalname))) {
    cb(null, true);
  } else {
    cb(ApiError.badRequest("File type not allowed."));
  }
};

//  Storage
// Memory storage keeps files in RAM as Buffers — required for Cloudinary uploads
// (which accept a Buffer, not a file path).

const memoryStorage = multer.memoryStorage();

//  Upload configurations

/** Single avatar image — max 5 MB.  Usage: uploadAvatar.single("avatar") */
export const uploadAvatar = multer({
  storage: memoryStorage,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: imageFilter,
});

/** Single server icon — max 5 MB.  Usage: uploadServerIcon.single("icon") */
export const uploadServerIcon = multer({
  storage: memoryStorage,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: imageFilter,
});

/** Single server banner — max 10 MB.  Usage: uploadServerBanner.single("banner") */
export const uploadServerBanner = multer({
  storage: memoryStorage,
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: imageFilter,
});

/** Up to 10 message attachments — max 10 MB each.  Usage: uploadAttachments.array("attachments", 10) */
export const uploadAttachments = multer({
  storage: memoryStorage,
  limits: { fileSize: 10 * 1024 * 1024, files: 10 },
  fileFilter: fileFilter,
});

/** Single custom emoji — max 2 MB.  Usage: uploadEmoji.single("emoji") */
export const uploadEmoji = multer({
  storage: memoryStorage,
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: imageFilter,
});

//  Multer error handler
// Register AFTER your upload routes: app.use(handleMulterError)
// Converts multer-specific errors to structured JSON responses.

export const handleMulterError = (err: unknown, _req: Request, res: Response, next: NextFunction): void => {
  if (!(err instanceof multer.MulterError)) {
    next(err); // Pass non-multer errors down the chain
    return;
  }

  const base = { success: false as const };

  switch (err.code) {
    case "LIMIT_FILE_SIZE":
      res.status(HTTP_STATUS.BAD_REQUEST).json({
        ...base,
        message: "File too large. Check the size limit for this upload type.",
        error: { code: err.code, field: err.field },
      });
      break;

    case "LIMIT_FILE_COUNT":
      res.status(HTTP_STATUS.BAD_REQUEST).json({
        ...base,
        message: "Too many files uploaded.",
        error: { code: err.code },
      });
      break;

    case "LIMIT_UNEXPECTED_FILE":
      res.status(HTTP_STATUS.BAD_REQUEST).json({
        ...base,
        message: "Unexpected field in the upload form.",
        error: { code: err.code, field: err.field },
      });
      break;

    default:
      res.status(HTTP_STATUS.BAD_REQUEST).json({
        ...base,
        message: "Upload error.",
        error: { code: err.code, message: err.message },
      });
  }
};