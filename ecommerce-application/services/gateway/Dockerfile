# Stage 1: builder stage. install production dependencies only
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Stage 2: runtime stage
FROM alpine:3.22
RUN apk add --no-cache nodejs \
 && addgroup -S -g 10001 app \
 && adduser -S -D -H -u 10001 -G app app
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

ARG APP_VERSION=dev
ENV NODE_ENV=production \
    APP_VERSION=${APP_VERSION} \
    PORT=3000

USER 10001
EXPOSE 3000
CMD ["node", "src/server.js"]
