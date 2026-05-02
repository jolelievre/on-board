### Stage 1: Install all dependencies (including devDependencies for build)
FROM node:20-alpine AS deps
RUN npm install -g npm@11
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev

### Stage 2: Build client + server
FROM node:20-alpine AS builder
WORKDIR /app
# DEPLOY_ENV controls per-environment PWA branding (icon badge + manifest
# name + theme color). Coolify passes this as a build arg per environment:
#   production → no badge, name "OnBoard"
#   integration → teal gear badge, name "OnBoard Dev"
#   preview → red bug badge, name "OnBoard Test"
ARG DEPLOY_ENV=production
ENV DEPLOY_ENV=${DEPLOY_ENV}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

### Stage 3: Production dependencies only
FROM node:20-alpine AS prod-deps
RUN npm install -g npm@11
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

### Stage 4: Runner
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

RUN addgroup --system --gid 1001 appgroup && \
    adduser --system --uid 1001 appuser

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY package.json ./
COPY scripts/entrypoint.sh ./scripts/entrypoint.sh

RUN chmod +x ./scripts/entrypoint.sh

USER appuser
EXPOSE 3000

ENTRYPOINT ["./scripts/entrypoint.sh"]
