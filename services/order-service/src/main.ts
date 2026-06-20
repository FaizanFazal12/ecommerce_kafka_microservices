import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { KafkaConsumerService } from './kafka/kafka-consumer.service';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip unknown properties
      forbidNonWhitelisted: true, // 400 on unknown properties
      transform: true, // turn plain JSON into DTO instances
    }),
  );
  app.enableShutdownHooks(); // so OnModuleDestroy hooks fire (disconnect Kafka/DB cleanly)

  // Start Kafka consumption AFTER all OnModuleInit hooks have registered their
  // handlers (the SagaConsumer registers in its onModuleInit).
  await app.get(KafkaConsumerService).start();

  const config = app.get(ConfigService);
  const port = config.get<number>('port')!;
  await app.listen(port);
  logger.log(`order-service listening on :${port}`);
}

void bootstrap();
