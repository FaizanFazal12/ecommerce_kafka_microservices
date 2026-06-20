import { Module } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { InventoryEventsConsumer } from './inventory-events.consumer';
import { OutboxModule } from '../outbox/outbox.module';

@Module({
  imports: [OutboxModule],
  providers: [InventoryService, InventoryEventsConsumer],
})
export class InventoryModule {}
