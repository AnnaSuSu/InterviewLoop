FROM oven/bun:1.3.14-slim

WORKDIR /app

COPY package.json bun.lock tsconfig.json tsconfig.node-compat.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/platform/package.json packages/platform/package.json
COPY packages/providers/package.json packages/providers/package.json
COPY packages/testing/package.json packages/testing/package.json
COPY frontend/package.json frontend/package.json
RUN bun install --frozen-lockfile --production --filter @techspar/api

COPY apps/api apps/api
COPY packages packages

ENV PORT=8000
EXPOSE 8000
CMD ["bun", "apps/api/src/entry.bun.ts"]
