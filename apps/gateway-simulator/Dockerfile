# syntax=docker/dockerfile:1
FROM node:24.21.0-alpine3.24 AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --ignore-scripts --filter "@smart/gateway-simulator..." \
 && pnpm --filter "@smart/gateway-simulator^..." build \
 && pnpm --filter @smart/gateway-simulator build \
 && pnpm --filter @smart/gateway-simulator deploy --prod /out

FROM node:24.21.0-alpine3.24
# npm, npx and corepack are not needed at runtime; removing them drops their bundled dependencies (CVE surface).
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
 && apk upgrade --no-cache
ENV NODE_ENV=production TZ=UTC
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
CMD ["node", "dist/main.js"]
