FROM node:22-alpine AS build
WORKDIR /app
COPY web/package.json web/package.json
RUN --mount=type=cache,target=/root/.npm npm install --prefix web
COPY web web
RUN npm run build --prefix web

FROM nginx:1.27-alpine
COPY --from=build /app/web/dist /usr/share/nginx/html
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
