# syntax=docker/dockerfile:1

# Stage 1: install production dependencies only
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Stage 2: runtime
# Plain Alpine plus the distro nodejs package. No npm, no yarn, no build tools,
# which keeps the image far below the 150 MB limit.
FROM alpine:3.22
RUN apk add --no-cache nodejs \
 && addgroup -S -g 10001 app \
 && adduser -S -D -H -u 10001 -G app app
WORKDIR /app
# Files stay owned by root, so the app user can read but not modify its own code.
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

ARG APP_VERSION=dev
ENV NODE_ENV=production \
    APP_VERSION=${APP_VERSION} \
    PORT=3002

# Numeric UID so Kubernetes runAsNonRoot can verify it without a runAsUser override.
USER 10001
EXPOSE 3002
CMD ["node", "src/server.js"]
