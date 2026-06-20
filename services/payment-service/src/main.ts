import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { KafkaConsumerService } from './kafka/kafka-consumer.service';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();

  // Start consuming after handlers are registered in their onModuleInit hooks.
  await app.get(KafkaConsumerService).start();

  const port = app.get(ConfigService).get<number>('port')!;
  await app.listen(port);
  logger.log(`payment-service listening on :${port}`);
}

void bootstrap();
