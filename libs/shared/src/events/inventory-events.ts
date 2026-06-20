import { EventEnvelope } from './envelope';
import { Topics } from './topics';

/** Emitted by Inventory Service when stock is successfully reserved for an order. */
export interface InventoryReservedPayload {
  orderId: string;
  reservationId: string;
  items: { productId: string; quantity: number }[];
}
export type InventoryReservedEvent = EventEnvelope<typeof Topics.INVENTORY_RESERVED, InventoryReservedPayload>;

/** Emitted when stock cannot be reserved (insufficient quantity). */
export interface InventoryRejectedPayload {
  orderId: string;
  reason: 'OUT_OF_STOCK';
  shortfalls: { productId: string; requested: number; available: number }[];
}
export type InventoryRejectedEvent = EventEnvelope<typeof Topics.INVENTORY_REJECTED, InventoryRejectedPayload>;
