# Multi-stage build for the order-service.
# Built from the repo root so the shared lib (libs/shared) is in context:
#   docker build -f services/order-service/Dockerfile -t order-service .

FROM node:20-alpine AS builder
WORKDIR /app

# Install deps using the workspace manifests (better layer caching)
COPY package.json package-lock.json* ./
COPY tsconfig.base.json ./
COPY libs/shared ./libs/shared
COPY services/order-service ./services/order-service
RUN npm install

# Generate Prisma client + compile both the shared lib and the service
RUN npm run build -w @ecommerce/shared \
 && cd services/order-service \
 && npx prisma generate \
 && npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/libs/shared/dist ./libs/shared/dist
COPY --from=builder /app/libs/shared/package.json ./libs/shared/package.json
COPY --from=builder /app/services/order-service/dist ./services/order-service/dist
COPY --from=builder /app/services/order-service/node_modules ./services/order-service/node_modules
COPY --from=builder /app/services/order-service/package.json ./services/order-service/package.json
COPY --from=builder /app/services/order-service/prisma ./services/order-service/prisma

WORKDIR /app/services/order-service
EXPOSE 3001
CMD ["node", "dist/main.js"]
