import { Request } from 'express';

/** Shape of our JWT payload. `sub` is the customer id. */
export interface JwtPayload {
  sub: string;
}

/** The authenticated principal we attach to the request after verifying the JWT. */
export interface AuthUser {
  customerId: string;
}

export interface AuthedRequest extends Request {
  user?: AuthUser;
  requestId?: string;
}
