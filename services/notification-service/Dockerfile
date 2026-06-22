# Build from repo root: docker build -f services/notification-service/Dockerfile -t notification-service .
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
COPY tsconfig.base.json ./
COPY libs/shared ./libs/shared
COPY services/notification-service ./services/notification-service
RUN npm install
RUN npm run build -w @ecommerce/shared \
 && cd services/notification-service \
 && npx prisma generate \
 && npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/libs/shared/dist ./libs/shared/dist
COPY --from=builder /app/libs/shared/package.json ./libs/shared/package.json
COPY --from=builder /app/services/notification-service/dist ./services/notification-service/dist
COPY --from=builder /app/services/notification-service/node_modules ./services/notification-service/node_modules
COPY --from=builder /app/services/notification-service/package.json ./services/notification-service/package.json
COPY --from=builder /app/services/notification-service/prisma ./services/notification-service/prisma
WORKDIR /app/services/notification-service
EXPOSE 3004
CMD ["node", "dist/main.js"]
