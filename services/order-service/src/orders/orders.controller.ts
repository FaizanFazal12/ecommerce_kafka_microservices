import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { IdempotencyKey } from '../idempotency/idempotency-key.decorator';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  /**
   * Create an order.
   *
   * Requires an `Idempotency-Key: <uuid>` header. Retrying with the same key
   * returns the original response (HTTP 201 with `Idempotent-Replayed: true`)
   * and never creates a second order or charge.
   *
   * We set the status code manually so a replay can echo the originally cached
   * code (e.g. 201) rather than always 200.
   */
  @Post()
  async create(
    @IdempotencyKey() idempotencyKey: string,
    @Body() dto: CreateOrderDto,
    @Res() res: Response,
  ): Promise<void> {
    const { response, statusCode, replayed } = await this.orders.createOrder(
      idempotencyKey,
      dto,
    );
    res.setHeader('Idempotent-Replayed', String(replayed));
    res.status(statusCode).json(response);
  }

  @Get(':id')
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.orders.findOne(id);
  }
}
