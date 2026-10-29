FROM node:24-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
ARG NEXT_PUBLIC_API_URL
ENV NEXT_TELEMETRY_DISABLED=1
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/domain/package.json packages/domain/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @scm/web...
COPY packages/domain packages/domain
COPY apps/web apps/web
RUN pnpm --filter @scm/domain build && pnpm --filter @scm/web build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
ENV API_INTERNAL_URL=http://api:4000
RUN addgroup -S scm && adduser -S scm -G scm
WORKDIR /app
COPY --from=build --chown=scm:scm /repo/apps/web/.next/standalone ./
COPY --from=build --chown=scm:scm /repo/apps/web/.next/static ./apps/web/.next/static
# Standalone does NOT serve public/ by itself — without this every brand asset 404s in prod.
COPY --from=build --chown=scm:scm /repo/apps/web/public ./apps/web/public
USER scm
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
