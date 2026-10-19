# syntax=docker/dockerfile:1.7
# AutoFlow API — multi-stage, pnpm-workspace aware. Build context is the REPOSITORY ROOT:
#   docker build -f apps/api/Dockerfile .
# Stage 1 installs the workspace (api + its workspace deps), builds @autoflow/core then the API,
# and uses `pnpm deploy` to produce a self-contained production bundle. Stage 2 runs it as non-root.

# Override to use a registry mirror, e.g. --build-arg NODE_IMAGE=mirror.gcr.io/library/node:22-bookworm-slim
ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS build
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /repo

# Manifests first for better layer caching of the dependency install.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/package.json
COPY apps/api/package.json apps/api/package.json
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "@autoflow/api..." --config.store-dir=/pnpm/store

COPY packages/core packages/core
COPY apps/api apps/api
RUN pnpm --filter @autoflow/core build \
 && pnpm --filter @autoflow/api build \
 && pnpm --filter @autoflow/api deploy --prod /out \
 && rm -rf /out/node_modules/.cache

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    PORT=8080
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
