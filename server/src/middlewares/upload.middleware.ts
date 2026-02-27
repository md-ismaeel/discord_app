import multer from "multer";
import path from "path";
import { createApiError } from "../utils/ApiError.js";
import { HTTP_STATUS } from "../constants/httpStatus.js";

// ============================================================================
// FILE FILTERS (What file types are allowed?)
// ============================================================================

/**
 * Accept only images (jpeg, jpg, png, gif, webp)
 */
const imageFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|webp/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (mimetype && extname) {
    cb(null, true);
  } else {
    cb(
      createApiError(
        HTTP_STATUS.BAD_REQUEST,
        "Only image files are allowed (jpeg, jpg, png, gif, webp)",
      ),
    );
  }
};

/**
 * Accept images and documents
 */
const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|webp|pdf|doc|docx|txt|zip|rar/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());

  if (extname) {
    cb(null, true);
  } else {
    cb(createApiError(HTTP_STATUS.BAD_REQUEST, "File type not allowed"));
  }
};

// ============================================================================
// STORAGE CONFIGURATION
// ============================================================================

/**
 * Memory Storage - Files stored in RAM as Buffer
 * Use this when uploading to Cloudinary (which we are doing)
 */
const memoryStorage = multer.memoryStorage();

// ============================================================================
// MULTER UPLOAD CONFIGURATIONS
// Each export is a pre-configured multer middleware
// Use like: router.post('/upload', uploadAvatar.single('avatar'), controller)
// ============================================================================

/**
 * Upload a single avatar image (max 5MB)
 * Usage: uploadAvatar.single('avatar')
 */
export const uploadAvatar = multer({
  storage: memoryStorage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
    files: 1,
  },
  fileFilter: imageFilter,
});

/**
 * Upload a single server icon (max 5MB)
 * Usage: uploadServerIcon.single('icon')
 */
export const uploadServerIcon = multer({
  storage: memoryStorage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
    files: 1,
  },
  fileFilter: imageFilter,
});

/**
 * Upload a single server banner (max 10MB)
 * Usage: uploadServerBanner.single('banner')
 */
export const uploadServerBanner = multer({
  storage: memoryStorage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    files: 1,
  },
  fileFilter: imageFilter,
});

/**
 * Upload message attachments (max 10 files, 10MB each)
 * Usage: uploadAttachments.array('attachments', 10)
 */
export const uploadAttachments = multer({
  storage: memoryStorage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB per file
    files: 10,
  },
  fileFilter: fileFilter,
});

/**
 * Upload custom emoji (max 2MB)
 * Usage: uploadEmoji.single('emoji')
 */
export const uploadEmoji = multer({
  storage: memoryStorage,
  limits: {
    fileSize: 2 * 1024 * 1024, // 2MB
    files: 1,
  },
  fileFilter: imageFilter,
});

// ============================================================================
// ERROR HANDLING MIDDLEWARE
// ============================================================================

/**
 * Handle multer-specific errors
 * Add this AFTER your routes: app.use(handleMulterError)
 */
export const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: "File too large. Check size limits for your upload type.",
        error: { code: err.code, field: err.field },
      });
    }

    if (err.code === "LIMIT_FILE_COUNT") {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: "Too many files. Maximum allowed exceeded.",
        error: { code: err.code },
      });
    }

    if (err.code === "LIMIT_UNEXPECTED_FILE") {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: "Unexpected field in upload.",
        error: { code: err.code, field: err.field },
      });
    }

    return res.status(HTTP_STATUS.BAD_REQUEST).json({
      success: false,
      message: "Upload error",
      error: { code: err.code, message: err.message },
    });
  }

  next(err);
};