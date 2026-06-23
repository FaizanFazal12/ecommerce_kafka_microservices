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

  const port = app.get(ConfigService).get<number>('port')!;
  // listen() runs the onModuleInit hooks that register the topic handlers; only
  // then can the consumer start (otherwise routes are empty and start() no-ops).
  await app.listen(port);

  await app.get(KafkaConsumerService).start();
  logger.log(`inventory-service listening on :${port}`);
}

void bootstrap();
