FROM nginxinc/nginx-unprivileged:1.29-alpine
USER root
# Patch OS packages in the base image (fixes CVEs before upstream rebuilds it)
RUN apk upgrade --no-cache
USER 101
ENV GATEWAY_URL=http://gateway:3000
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY public/ /usr/share/nginx/html/

EXPOSE 8080
