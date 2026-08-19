FROM node:22-alpine AS build
WORKDIR /app
COPY control-plane/package.json control-plane/package.json
RUN --mount=type=cache,target=/root/.npm npm install --prefix control-plane
COPY control-plane control-plane
RUN npm run build --prefix control-plane

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/control-plane/package.json ./package.json
RUN --mount=type=cache,target=/root/.npm npm install --omit=dev
COPY --from=build /app/control-plane/dist ./dist
EXPOSE 8080
CMD ["node", "dist/index.js"]
