FROM node:24-alpine AS build

WORKDIR /build/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY frontend/ ./
ARG VITE_API_BASE_URL=""
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build

FROM nginx:alpine

ENV BACKEND_URL=http://backend:8787 \
    NGINX_ENVSUBST_FILTER=^BACKEND_URL$

COPY frontend/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /build/frontend/dist /usr/share/nginx/html

EXPOSE 80
