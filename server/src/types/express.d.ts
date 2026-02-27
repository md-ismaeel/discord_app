// Augments Express's global Request and User types so req.user is IUser
// everywhere in the codebase — no casting required in controllers or middleware.
//
// Rules for ambient declaration files:
//   1. Use `import type` — never import values, only types.
//   2. Must export {} so TypeScript treats this as a module, not a script.
//   3. Must be included in tsconfig "include" (covered by "src/**/*").

import type { IUser } from "@/types/models";

declare global {
  namespace Express {
    /**
     * Passport deserialises the session user into req.user.
     * Extending this interface types req.user as IUser throughout the app.
     */
    interface User extends IUser { }

    interface Request {
      /** Populated by Passport after successful authentication */
      user?: IUser;
      /** Raw JWT string — populated by the JWT auth middleware */
      token?: string;
      /** Real client IP resolved through reverse proxies */
      clientIp?: string;
    }
  }
}

export { };