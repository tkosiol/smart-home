# syntax=docker/dockerfile:1
FROM node:24.21.0-alpine3.24 AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --ignore-scripts --filter "@smart/frontend..." \
 && pnpm --filter "@smart/frontend^..." build \
 && pnpm --filter @smart/frontend build

FROM nginxinc/nginx-unprivileged:1.31.6-alpine3.24
# Pull in security fixes of Alpine packages released after the base image was built.
USER root
RUN apk upgrade --no-cache
USER 101
COPY apps/frontend/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY apps/frontend/nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /repo/apps/frontend/dist/frontend/browser /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
