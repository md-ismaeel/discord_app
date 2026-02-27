import { IUser } from "./models";

declare global {
  namespace Express {
    interface Request {
      user?: IUser;
      token?: string;
      clientIp?: string;
    }

    interface User extends IUser {}
  }
}

export {};
