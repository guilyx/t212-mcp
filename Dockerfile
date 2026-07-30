# Build stage: dev dependencies stay here and never reach the runtime image.
FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsup.config.ts ./
COPY src ./src
RUN npm run build

# Runtime stage.
FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# Never run as root: this process holds brokerage credentials in memory.
USER node

# stdio transport — the container needs `docker run -i`.
ENTRYPOINT ["node", "dist/index.js"]
