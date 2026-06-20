import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { KafkaModule } from './kafka/kafka.module';
import { OutboxModule } from './outbox/outbox.module';
import { IdempotencyModule } from './idempotency/idempotency.module';
import { OrdersModule } from './orders/orders.module';
import { ConsumersModule } from './consumers/consumers.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    // Global infra modules
    PrismaModule,
    RedisModule,
    KafkaModule,
    // Feature modules
    OutboxModule, // registers the relay worker (Layer 2)
    IdempotencyModule, // Layer 1
    OrdersModule,
    ConsumersModule, // Layer 3 saga consumers
  ],
  controllers: [HealthController],
})
export class AppModule {}
