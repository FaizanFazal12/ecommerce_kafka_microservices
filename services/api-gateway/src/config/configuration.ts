export interface AppConfig {
  port: number;
  serviceName: string;
  orderServiceUrl: string;
  redisUrl: string;
  jwt: { secret: string; expiresIn: string };
  rateLimit: { max: number; windowSeconds: number };
}

export default (): AppConfig => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  serviceName: process.env.SERVICE_NAME ?? 'api-gateway',
  orderServiceUrl: process.env.ORDER_SERVICE_URL ?? 'http://localhost:3001',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  jwt: {
    secret: process.env.JWT_SECRET ?? 'dev-only-change-me',
    expiresIn: process.env.JWT_EXPIRES_IN ?? '1h',
  },
  rateLimit: {
    max: parseInt(process.env.RATE_LIMIT_MAX ?? '20', 10),
    windowSeconds: parseInt(process.env.RATE_LIMIT_WINDOW_SECONDS ?? '10', 10),
  },
});
