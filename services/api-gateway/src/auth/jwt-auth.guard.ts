import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthedRequest, JwtPayload } from './auth.types';

/**
 * Verifies the `Authorization: Bearer <jwt>` header and attaches the principal
 * (`req.user = { customerId }`) for downstream handlers. This is the
 * authentication boundary — only the gateway checks tokens; internal services
 * trust the gateway (a common edge-auth pattern).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.header('authorization');
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing Bearer token');
    }
    const token = header.slice('Bearer '.length);
    try {
      const payload = this.jwt.verify<JwtPayload>(token);
      if (!payload?.sub) throw new Error('no subject');
      req.user = { customerId: payload.sub };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
