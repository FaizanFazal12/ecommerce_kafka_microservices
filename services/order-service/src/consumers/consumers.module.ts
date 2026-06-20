import { Module } from '@nestjs/common';
import { SagaConsumer } from './saga.consumer';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [OrdersModule],
  providers: [SagaConsumer],
  exports: [SagaConsumer],
})
export class ConsumersModule {}
