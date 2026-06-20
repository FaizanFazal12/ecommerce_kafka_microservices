import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OutboxModule } from '../outbox/outbox.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';

@Module({
  imports: [OutboxModule, IdempotencyModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
