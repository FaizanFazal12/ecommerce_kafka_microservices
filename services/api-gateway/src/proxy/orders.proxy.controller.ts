import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard';
import { AuthedRequest } from '../auth/auth.types';
import { ProxyService, ProxyResult } from './proxy.service';

/**
 * Public edge for the Orders API. Every route is authenticated and rate-limited,
 * then proxied to the Order Service.
 *
 * Security property worth noting: the gateway injects `customerId` from the
 * verified JWT into the forwarded body, so a caller can only ever place orders as
 * themselves — the client-supplied customerId (if any) is ignored.
 */
@Controller('orders')
@UseGuards(JwtAuthGuard, RateLimitGuard)
export class OrdersProxyController {
  constructor(private readonly proxy: ProxyService) {}

  @Post()
  async create(
    @Req() req: AuthedRequest,
    @Body() body: Record<string, unknown>,
    @Res() res: Response,
  ): Promise<void> {
    const idempotencyKey = req.header('Idempotency-Key');
    if (!idempotencyKey) {
      throw new BadRequestException('Idempotency-Key header is required.');
    }
    // Authoritative customer id comes from the token, not the client body.
    const forwardedBody = { ...body, customerId: req.user!.customerId };

    const result = await this.proxy.toOrderService('POST', '/orders', {
      body: forwardedBody,
      idempotencyKey,
      requestId: req.requestId,
    });
    this.send(res, result);
  }

  @Get(':id')
  async findOne(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.proxy.toOrderService('GET', `/orders/${id}`, {
      requestId: req.requestId,
    });
    this.send(res, result);
  }

  /** Relay the downstream response faithfully (status, body, useful headers). */
  private send(res: Response, result: ProxyResult): void {
    if (result.contentType) res.setHeader('Content-Type', result.contentType);
    if (result.replayed !== null) res.setHeader('Idempotent-Replayed', result.replayed);
    res.status(result.status).send(result.body);
  }
}
