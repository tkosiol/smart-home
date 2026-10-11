# syntax=docker/dockerfile:1
FROM node:24.21.0-alpine3.24 AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --ignore-scripts --filter "@smart/backend..." \
 && pnpm --filter @smart/contracts build \
 && pnpm --filter @smart/backend build \
 && pnpm --filter @smart/backend deploy --prod /out

FROM node:24.21.0-alpine3.24
ENV NODE_ENV=production TZ=UTC
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health/live').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
CMD ["node", "dist/main.js"]
