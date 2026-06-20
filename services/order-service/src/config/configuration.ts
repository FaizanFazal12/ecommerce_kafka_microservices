/** Typed configuration loaded from environment variables. */
export interface AppConfig {
  port: number;
  serviceName: string;
  databaseUrl: string;
  redisUrl: string;
  kafka: {
    brokers: string[];
    clientId: string;
    consumerGroup: string;
  };
  outbox: {
    pollIntervalMs: number;
    batchSize: number;
  };
  idempotencyTtlSeconds: number;
}

export default (): AppConfig => ({
  port: parseInt(process.env.PORT ?? '3001', 10),
  serviceName: process.env.SERVICE_NAME ?? 'order-service',
  databaseUrl: process.env.DATABASE_URL ?? '',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  kafka: {
    brokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(','),
    clientId: process.env.KAFKA_CLIENT_ID ?? 'order-service',
    consumerGroup: process.env.KAFKA_CONSUMER_GROUP ?? 'order-service',
  },
  outbox: {
    pollIntervalMs: parseInt(process.env.OUTBOX_POLL_INTERVAL_MS ?? '1000', 10),
    batchSize: parseInt(process.env.OUTBOX_BATCH_SIZE ?? '50', 10),
  },
  idempotencyTtlSeconds: parseInt(process.env.IDEMPOTENCY_TTL_SECONDS ?? '86400', 10),
});
