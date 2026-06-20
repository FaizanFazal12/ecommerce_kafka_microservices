# Build from repo root: docker build -f services/inventory-service/Dockerfile -t inventory-service .
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
COPY tsconfig.base.json ./
COPY libs/shared ./libs/shared
COPY services/inventory-service ./services/inventory-service
RUN npm install
RUN npm run build -w @ecommerce/shared \
 && cd services/inventory-service \
 && npx prisma generate \
 && npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/libs/shared/dist ./libs/shared/dist
COPY --from=builder /app/libs/shared/package.json ./libs/shared/package.json
COPY --from=builder /app/services/inventory-service/dist ./services/inventory-service/dist
COPY --from=builder /app/services/inventory-service/node_modules ./services/inventory-service/node_modules
COPY --from=builder /app/services/inventory-service/package.json ./services/inventory-service/package.json
COPY --from=builder /app/services/inventory-service/prisma ./services/inventory-service/prisma
WORKDIR /app/services/inventory-service
EXPOSE 3003
CMD ["node", "dist/main.js"]
