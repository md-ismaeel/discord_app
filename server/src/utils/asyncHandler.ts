import type { NextFunction, Request, Response, RequestHandler } from "express";

// The async route handler signature — same as Express RequestHandler but async.
type AsyncRequestHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

export const asyncHandler = (fn: AsyncRequestHandler): RequestHandler => {
  // Guard at runtime as well as compile-time — catches accidental non-function args
  if (typeof fn !== "function") {
    throw new TypeError(`asyncHandler expects a function, received: ${typeof fn}`);
  }

  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
