FROM oven/bun:1.4.1 AS builder
WORKDIR /app

COPY package.json bun.lock ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages/api-contract/package.json ./packages/api-contract/package.json
COPY packages/email-editor/package.json ./packages/email-editor/package.json
COPY packages/email-blocks/package.json ./packages/email-blocks/package.json

RUN bun install --frozen-lockfile --ignore-scripts --filter @sendlit/web --filter @sendlit/email-editor --filter @sendlit/email-blocks

COPY packages/api-contract ./packages/api-contract
COPY packages/email-editor ./packages/email-editor
COPY packages/email-blocks ./packages/email-blocks
COPY apps/web ./apps/web

ENV NEXT_TELEMETRY_DISABLED=1

RUN bun --filter @sendlit/email-editor build \
    && bun --filter @sendlit/email-blocks build \
    && bun --filter @sendlit/web build

FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 --ingroup nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

USER nextjs

EXPOSE 3000

CMD ["node", "apps/web/server.js"]
