export interface AppConfig {
  port: number;
  serviceName: string;
  databaseUrl: string;
  kafka: { brokers: string[]; clientId: string; consumerGroup: string };
  consumer: { maxRetries: number; retryBackoffMs: number };
}

export default (): AppConfig => ({
  port: parseInt(process.env.PORT ?? '3004', 10),
  serviceName: process.env.SERVICE_NAME ?? 'notification-service',
  databaseUrl: process.env.DATABASE_URL ?? '',
  kafka: {
    brokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(','),
    clientId: process.env.KAFKA_CLIENT_ID ?? 'notification-service',
    consumerGroup: process.env.KAFKA_CONSUMER_GROUP ?? 'notification-service',
  },
  consumer: {
    maxRetries: parseInt(process.env.CONSUMER_MAX_RETRIES ?? '3', 10),
    retryBackoffMs: parseInt(process.env.CONSUMER_RETRY_BACKOFF_MS ?? '500', 10),
  },
});
