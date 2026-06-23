import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface ProxyResult {
  status: number;
  body: string;
  contentType: string | null;
  replayed: string | null;
}

/**
 * Minimal reverse proxy to the Order Service using the platform's native fetch.
 * Forwards only the headers we explicitly allow (never blindly pipes the
 * client's Authorization downstream) and propagates the trace + idempotency headers.
 */
@Injectable()
export class ProxyService {
  private readonly logger = new Logger(ProxyService.name);
  private readonly orderBaseUrl: string;

  constructor(config: ConfigService) {
    this.orderBaseUrl = config.get<string>('orderServiceUrl')!;
  }

  async toOrderService(
    method: 'GET' | 'POST',
    path: string,
    opts: { body?: unknown; idempotencyKey?: string; requestId?: string },
  ): Promise<ProxyResult> {
    const url = `${this.orderBaseUrl}${path}`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
    if (opts.requestId) headers['X-Request-Id'] = opts.requestId;

    const res = await fetch(url, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });

    return {
      status: res.status,
      body: await res.text(),
      contentType: res.headers.get('content-type'),
      replayed: res.headers.get('Idempotent-Replayed'),
    };
  }
}
