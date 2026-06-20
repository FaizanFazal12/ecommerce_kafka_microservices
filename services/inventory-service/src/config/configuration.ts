export interface AppConfig {
  port: number;
  serviceName: string;
  databaseUrl: string;
  kafka: { brokers: string[]; clientId: string; consumerGroup: string };
  outbox: { pollIntervalMs: number; batchSize: number };
  defaultStock: number;
}

export default (): AppConfig => ({
  port: parseInt(process.env.PORT ?? '3003', 10),
  serviceName: process.env.SERVICE_NAME ?? 'inventory-service',
  databaseUrl: process.env.DATABASE_URL ?? '',
  kafka: {
    brokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(','),
    clientId: process.env.KAFKA_CLIENT_ID ?? 'inventory-service',
    consumerGroup: process.env.KAFKA_CONSUMER_GROUP ?? 'inventory-service',
  },
  outbox: {
    pollIntervalMs: parseInt(process.env.OUTBOX_POLL_INTERVAL_MS ?? '1000', 10),
    batchSize: parseInt(process.env.OUTBOX_BATCH_SIZE ?? '50', 10),
  },
  defaultStock: parseInt(process.env.DEFAULT_STOCK ?? '100', 10),
});
