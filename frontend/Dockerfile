FROM oven/bun:1.3.14-alpine AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/platform/package.json packages/platform/package.json
COPY packages/providers/package.json packages/providers/package.json
COPY packages/testing/package.json packages/testing/package.json
COPY frontend/package.json frontend/package.json
RUN bun install --frozen-lockfile --filter frontend
COPY frontend frontend
RUN bun run --cwd frontend build

FROM nginx:alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
