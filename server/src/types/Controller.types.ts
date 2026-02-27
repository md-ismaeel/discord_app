import type { Types } from "mongoose";
import type { Request, Response } from "express";

// ─── Augmented request types ──────────────────────────────────────────────────
// Every authenticated route has req.user populated by the auth middleware.
// req.clientIp is populated by express-ip or similar middleware.

export interface AuthenticatedRequest extends Request {
    user: {
        _id: Types.ObjectId;
        username: string;
        email: string;
        provider: string;
    };
    clientIp?: string;
}

// ─── Common paginated response ────────────────────────────────────────────────

export interface PaginationMeta {
    page: number;
    limit: number;
    total: number;
    pages: number;
    hasMore: boolean;
}