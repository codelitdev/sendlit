FROM oven/bun:1.4.1 AS packages
WORKDIR /app

COPY package.json bun.lock ./
COPY apps/api/package.json ./apps/api/package.json
COPY packages/api-contract/package.json ./packages/api-contract/package.json
COPY packages/test-utils/package.json ./packages/test-utils/package.json
COPY packages/email-editor/package.json ./packages/email-editor/package.json
COPY packages/email-blocks/package.json ./packages/email-blocks/package.json

RUN bun install --frozen-lockfile --ignore-scripts --filter @sendlit/api --filter @sendlit/email-editor --filter @sendlit/email-blocks

COPY packages/api-contract ./packages/api-contract
COPY packages/email-editor ./packages/email-editor
COPY packages/email-blocks ./packages/email-blocks

RUN bun --filter @sendlit/email-editor build && bun --filter @sendlit/email-blocks build

FROM oven/bun:1.4.1 AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY package.json bun.lock ./
COPY apps/api/package.json ./apps/api/package.json
COPY packages/api-contract/package.json ./packages/api-contract/package.json
COPY packages/test-utils/package.json ./packages/test-utils/package.json
COPY packages/email-editor/package.json ./packages/email-editor/package.json
COPY packages/email-blocks/package.json ./packages/email-blocks/package.json

RUN bun install --frozen-lockfile --production --ignore-scripts --filter @sendlit/api

COPY packages/api-contract ./packages/api-contract
COPY --from=packages /app/packages/email-editor/dist ./packages/email-editor/dist
COPY --from=packages /app/packages/email-blocks/dist ./packages/email-blocks/dist
COPY apps/api ./apps/api

USER bun

EXPOSE 4000

CMD ["bun", "apps/api/src/index.ts"]
