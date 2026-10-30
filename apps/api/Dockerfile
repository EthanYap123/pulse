# syntax=docker/dockerfile:1

# Build context is the repository root:
#   docker build -f apps/api/Dockerfile -t pulse-api .

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH HUSKY=0 TURBO_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

# 1. Install dependencies for the API and the packages it uses.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "@pulse/api..."

# 2. Build shared + API, then copy out a production-only tree.
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @pulse/shared build \
 && pnpm --filter @pulse/api generate \
 && pnpm --filter @pulse/api build
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm deploy --filter @pulse/api --prod --legacy /out

# 3. Small runtime image: no pnpm, no dev dependencies, non-root user.
FROM node:22-alpine AS runtime
ENV NODE_ENV=production PORT=4000
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" > /dev/null || exit 1
CMD ["node", "dist/server.js"]
