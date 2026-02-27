import type { NextFunction, Request, Response, RequestHandler } from "express";

// ─── Types

// The async route handler signature — same as Express RequestHandler but async.
type AsyncRequestHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

// ─── asyncHandler
// Wraps an async Express handler so unhandled promise rejections are forwarded
// to the next() error chain instead of crashing the process.
//
// Before:
//   router.get("/", asyncHandler(async (req, res, next) => { ... }))
//
// Without asyncHandler you'd need try/catch in every controller.

export const asyncHandler = (fn: AsyncRequestHandler): RequestHandler => {
  // Guard at runtime as well as compile-time — catches accidental non-function args
  if (typeof fn !== "function") {
    throw new TypeError(
      `asyncHandler expects a function, received: ${typeof fn}`,
    );
  }

  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
