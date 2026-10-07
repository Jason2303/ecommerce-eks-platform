FROM nginxinc/nginx-unprivileged:1.29-alpine
ENV GATEWAY_URL=http://gateway:3000
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY public/ /usr/share/nginx/html/

EXPOSE 8080
