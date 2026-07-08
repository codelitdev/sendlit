FROM node:24-alpine AS base
RUN corepack enable pnpm

FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json ./
COPY pnpm-lock.yaml ./
COPY pnpm-workspace.yaml ./
COPY apps/api ./apps/api
COPY packages/api-contract ./packages/api-contract
COPY packages/email-editor ./packages/email-editor

RUN pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/ ./

RUN pnpm --filter=@sendlit/email-editor build
RUN pnpm --filter=@sendlit/api-contract build
RUN pnpm --filter=@sendlit/api build

FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nodeuser

COPY --chown=nodeuser:nodejs --from=builder /app/package.json ./
COPY --chown=nodeuser:nodejs --from=builder /app/pnpm-lock.yaml ./
COPY --chown=nodeuser:nodejs --from=builder /app/pnpm-workspace.yaml ./

COPY --chown=nodeuser:nodejs --from=builder /app/packages/email-editor/package.json ./packages/email-editor/package.json
COPY --chown=nodeuser:nodejs --from=builder /app/packages/email-editor/dist ./packages/email-editor/dist

COPY --chown=nodeuser:nodejs --from=builder /app/packages/api-contract/package.json ./packages/api-contract/package.json
COPY --chown=nodeuser:nodejs --from=builder /app/packages/api-contract/dist ./packages/api-contract/dist

COPY --chown=nodeuser:nodejs --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --chown=nodeuser:nodejs --from=builder /app/apps/api/dist ./apps/api/dist
COPY --chown=nodeuser:nodejs --from=builder /app/apps/api/drizzle ./apps/api/drizzle

RUN pnpm install --prod --frozen-lockfile --ignore-scripts

USER nodeuser

EXPOSE 3001

CMD ["node", "apps/api/dist/index.js"]
