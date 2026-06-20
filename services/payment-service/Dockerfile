# Build from repo root: docker build -f services/payment-service/Dockerfile -t payment-service .
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
COPY tsconfig.base.json ./
COPY libs/shared ./libs/shared
COPY services/payment-service ./services/payment-service
RUN npm install
RUN npm run build -w @ecommerce/shared \
 && cd services/payment-service \
 && npx prisma generate \
 && npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/libs/shared/dist ./libs/shared/dist
COPY --from=builder /app/libs/shared/package.json ./libs/shared/package.json
COPY --from=builder /app/services/payment-service/dist ./services/payment-service/dist
COPY --from=builder /app/services/payment-service/node_modules ./services/payment-service/node_modules
COPY --from=builder /app/services/payment-service/package.json ./services/payment-service/package.json
COPY --from=builder /app/services/payment-service/prisma ./services/payment-service/prisma
WORKDIR /app/services/payment-service
EXPOSE 3002
CMD ["node", "dist/main.js"]
