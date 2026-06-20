import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { OrderEventsConsumer } from './order-events.consumer';
import { OutboxModule } from '../outbox/outbox.module';

@Module({
  imports: [OutboxModule],
  providers: [PaymentsService, OrderEventsConsumer],
})
export class PaymentsModule {}
