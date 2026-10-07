# syntax=docker/dockerfile:1

# nginx-unprivileged runs as UID 101 and listens on 8080 (no root, no port 80).
FROM nginxinc/nginx-unprivileged:1.29-alpine

# Where nginx proxies /api in Docker Compose. Overridable at run time.
ENV GATEWAY_URL=http://gateway:3000

# Files in /etc/nginx/templates are rendered into /etc/nginx/conf.d at startup.
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY public/ /usr/share/nginx/html/

EXPOSE 8080
