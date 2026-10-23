# One image for api, worker and migrate (different commands). Built from the repo root.
FROM node:24-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/domain/package.json packages/domain/
COPY packages/db/package.json packages/db/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @scm/api...
COPY packages packages
COPY apps/api apps/api
RUN pnpm --filter @scm/domain build && pnpm --filter @scm/db build && pnpm --filter @scm/api build
RUN pnpm deploy --legacy --filter @scm/api --prod /out

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
RUN apk add --no-cache tini && addgroup -S scm && adduser -S scm -G scm
WORKDIR /app
COPY --from=build --chown=scm:scm /out .
USER scm
EXPOSE 4000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--enable-source-maps", "dist/main.js"]
