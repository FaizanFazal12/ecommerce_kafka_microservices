# Build from repo root: docker build -f services/api-gateway/Dockerfile -t api-gateway .
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
COPY tsconfig.base.json ./
COPY services/api-gateway ./services/api-gateway
RUN npm install
RUN cd services/api-gateway && npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/services/api-gateway/dist ./services/api-gateway/dist
COPY --from=builder /app/services/api-gateway/node_modules ./services/api-gateway/node_modules
COPY --from=builder /app/services/api-gateway/package.json ./services/api-gateway/package.json
WORKDIR /app/services/api-gateway
EXPOSE 3000
CMD ["node", "dist/main.js"]
