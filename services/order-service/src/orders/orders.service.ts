import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../prisma/client';
import {
  createEvent,
  Topics,
  OrderCreatedPayload,
  OrderConfirmedPayload,
  OrderCancelledPayload,
} from '@ecommerce/shared';
import { PrismaService } from '../prisma/prisma.service';
import { OutboxService } from '../outbox/outbox.service';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { CreateOrderDto } from './dto/create-order.dto';

const PRODUCER = 'order-service';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly idempotency: IdempotencyService,
  ) {}

  /**
   * Create an order idempotently.
   *
   * Everything below happens in ONE transaction (provided by IdempotencyService):
   *   - the idempotency key is recorded
   *   - the order + items are inserted
   *   - the `orders.created` event is staged in the outbox
   * All commit together, or nothing does. The relay publishes the event later.
   */
  async createOrder(idempotencyKey: string, dto: CreateOrderDto) {
    const result = await this.idempotency.execute(idempotencyKey, dto, async (tx) => {
      const orderId = randomUUID();
      const correlationId = randomUUID();
      const currency = dto.currency ?? 'USD';
      const totalAmountCents = dto.items.reduce(
        (sum, i) => sum + i.quantity * i.unitPriceCents,
        0,
      );

      const order = await tx.order.create({
        data: {
          id: orderId,
          customerId: dto.customerId,
          status: 'PENDING',
          totalAmountCents,
          currency,
          correlationId,
          items: {
            create: dto.items.map((i) => ({
              productId: i.productId,
              quantity: i.quantity,
              unitPriceCents: i.unitPriceCents,
            })),
          },
        },
        include: { items: true },
      });

      // Stage the event in the SAME transaction (Layer 2).
      const payload: OrderCreatedPayload = {
        orderId,
        customerId: dto.customerId,
        items: dto.items.map((i) => ({
          productId: i.productId,
          quantity: i.quantity,
          unitPriceCents: i.unitPriceCents,
        })),
        totalAmountCents,
        currency,
      };
      const event = createEvent({
        eventType: Topics.ORDERS_CREATED,
        correlationId,
        aggregateId: orderId,
        producer: PRODUCER,
        payload,
      });
      await this.outbox.enqueue(tx, Topics.ORDERS_CREATED, event);

      const response = this.toResponse(order);
      return { response, statusCode: 201 };
    });

    this.logger.log(
      `Order ${result.response.id} ${result.replayed ? 'REPLAYED' : 'created'} (key ${idempotencyKey})`,
    );
    return result;
  }

  async findOne(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!order) throw new NotFoundException(`Order ${orderId} not found`);
    return this.toResponse(order);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Saga transitions (called by the event consumers, each already deduped).
  // These run inside the consumer's transaction so the state change + any
  // resulting outbox event commit atomically with the ProcessedEvent row.
  // ───────────────────────────────────────────────────────────────────────────

  /** Mark one saga leg's outcome, then settle the order if both legs are decided. */
  async applyLegOutcome(
    tx: Prisma.TransactionClient,
    orderId: string,
    leg: 'payment' | 'inventory',
    outcome: 'SUCCEEDED' | 'FAILED',
  ): Promise<void> {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order || order.status !== 'PENDING') {
      // Unknown order, or already settled — nothing to do (also keeps this idempotent).
      return;
    }

    const data =
      leg === 'payment' ? { paymentStatus: outcome } : { inventoryStatus: outcome };
    const updated = await tx.order.update({ where: { id: orderId }, data });

    // Any failed leg cancels the whole order (and triggers compensation downstream).
    if (updated.paymentStatus === 'FAILED' || updated.inventoryStatus === 'FAILED') {
      await this.settleCancelled(tx, orderId, updated.customerId);
      return;
    }

    // Both legs succeeded -> confirm.
    if (updated.paymentStatus === 'SUCCEEDED' && updated.inventoryStatus === 'SUCCEEDED') {
      await this.settleConfirmed(tx, orderId, updated.customerId, updated.totalAmountCents);
    }
  }

  private async settleConfirmed(
    tx: Prisma.TransactionClient,
    orderId: string,
    customerId: string,
    totalAmountCents: number,
  ): Promise<void> {
    const order = await tx.order.update({
      where: { id: orderId },
      data: { status: 'CONFIRMED' },
    });
    const payload: OrderConfirmedPayload = { orderId, customerId, totalAmountCents };
    await this.outbox.enqueue(
      tx,
      Topics.ORDERS_CONFIRMED,
      createEvent({
        eventType: Topics.ORDERS_CONFIRMED,
        correlationId: order.correlationId,
        aggregateId: orderId,
        producer: PRODUCER,
        payload,
      }),
    );
    this.logger.log(`Order ${orderId} CONFIRMED`);
  }

  private async settleCancelled(
    tx: Prisma.TransactionClient,
    orderId: string,
    customerId: string,
  ): Promise<void> {
    const order = await tx.order.update({
      where: { id: orderId },
      data: { status: 'CANCELLED' },
    });
    // reason derives from which leg failed
    const reason: OrderCancelledPayload['reason'] =
      order.paymentStatus === 'FAILED' ? 'PAYMENT_FAILED' : 'OUT_OF_STOCK';
    const payload: OrderCancelledPayload = { orderId, customerId, reason };
    await this.outbox.enqueue(
      tx,
      Topics.ORDERS_CANCELLED,
      createEvent({
        eventType: Topics.ORDERS_CANCELLED,
        correlationId: order.correlationId,
        aggregateId: orderId,
        producer: PRODUCER,
        payload,
      }),
    );
    this.logger.log(`Order ${orderId} CANCELLED (${reason})`);
  }

  private toResponse(order: {
    id: string;
    customerId: string;
    status: string;
    paymentStatus: string;
    inventoryStatus: string;
    totalAmountCents: number;
    currency: string;
    correlationId: string;
    createdAt: Date;
    items: { productId: string; quantity: number; unitPriceCents: number }[];
  }) {
    return {
      id: order.id,
      customerId: order.customerId,
      status: order.status,
      paymentStatus: order.paymentStatus,
      inventoryStatus: order.inventoryStatus,
      totalAmountCents: order.totalAmountCents,
      currency: order.currency,
      correlationId: order.correlationId,
      createdAt: order.createdAt,
      items: order.items.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
        unitPriceCents: i.unitPriceCents,
      })),
    };
  }
}
