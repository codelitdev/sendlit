# Install and build run on the build machine's own platform ($BUILDPLATFORM):
# the output is JavaScript, the same for every target, and emulating arm64 on
# an x86 builder (or the reverse) is several times slower. Only the runtime
# stage below is the target platform, with sharp's native binaries for it.
FROM --platform=$BUILDPLATFORM oven/bun:1.4.1 AS builder
WORKDIR /app

COPY package.json bun.lock ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages/api-contract/package.json ./packages/api-contract/package.json
COPY packages/test-utils/package.json ./packages/test-utils/package.json
COPY packages/email-editor/package.json ./packages/email-editor/package.json
COPY packages/email-blocks/package.json ./packages/email-blocks/package.json

RUN bun install --frozen-lockfile --ignore-scripts --filter @sendlit/web --filter @sendlit/email-editor --filter @sendlit/email-blocks

COPY packages/api-contract ./packages/api-contract
COPY packages/test-utils ./packages/test-utils
COPY packages/email-editor ./packages/email-editor
COPY packages/email-blocks ./packages/email-blocks
COPY apps/web ./apps/web

ENV NEXT_TELEMETRY_DISABLED=1

RUN bun --filter @sendlit/email-editor build \
    && bun --filter @sendlit/email-blocks build \
    && bun --filter @sendlit/web build

# sharp (Next.js image optimization) is the one native module traced into the
# standalone output. Fetch its binaries for the target platform, at the
# version the lockfile resolved, without running anything for that platform.
# The runner is Alpine, so fetch the musl builds (on a glibc build machine bun
# would fetch only glibc ones).
ARG TARGETARCH
RUN version=$(sed -n 's/^ *"sharp": \["sharp@\([0-9.]*\)".*/\1/p' bun.lock | head -n 1) \
    && test -n "$version" \
    && mkdir -p /target-sharp && cd /target-sharp \
    && printf '{"dependencies":{"sharp":"%s"}}' "$version" > package.json \
    && bun install --production --os=linux --libc=musl \
        --cpu=$([ "$TARGETARCH" = amd64 ] && echo x64 || echo "$TARGETARCH")

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
# Put the target platform's sharp binaries (@img/sharp-*, which include
# libvips) beside each traced copy of sharp. Packages already there (the
# build platform's, or JavaScript ones such as @img/colour) are left as is.
COPY --from=builder /target-sharp/node_modules/@img /tmp/target-img
RUN for dir in $(find node_modules -type d -path '*/node_modules/sharp'); do \
        mkdir -p "$dir/../@img"; \
        for pkg in /tmp/target-img/sharp-*; do \
            [ -e "$dir/../@img/${pkg##*/}" ] || cp -R "$pkg" "$dir/../@img/"; \
        done; \
    done \
    && rm -rf /tmp/target-img

USER nextjs

EXPOSE 3000

CMD ["node", "apps/web/server.js"]
