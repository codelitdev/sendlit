FROM node:24-alpine AS base
RUN corepack enable pnpm

FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json ./
COPY pnpm-lock.yaml ./
COPY pnpm-workspace.yaml ./
COPY apps/web ./apps/web
COPY packages/api-contract ./packages/api-contract
COPY packages/email-editor ./packages/email-editor
COPY packages/email-blocks ./packages/email-blocks

RUN pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/ ./

RUN pnpm --filter=@sendlit/email-editor build
RUN pnpm --filter=@sendlit/api-contract build
RUN pnpm --filter=@sendlit/email-blocks build
RUN pnpm --filter=@sendlit/web build

FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

USER nextjs

EXPOSE 3000

CMD ["node", "apps/web/server.js"]
