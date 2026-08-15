FROM node:22-bookworm-slim AS dependencies

WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build

COPY . .
RUN NX_DAEMON=false NG_BUILD_MAX_WORKERS=1 npx nx build speak-flow --configuration=production --skip-nx-cache
RUN npx esbuild apps/speak-flow/src/database/migrate.ts \
  --bundle \
  --platform=node \
  --format=esm \
  --external:pg \
  --outfile=dist/tools/migrate.mjs \
  && mkdir -p dist/tools/migrations \
  && cp apps/speak-flow/src/database/migrations/*.sql dist/tools/migrations/
RUN npm prune --omit=dev && npm cache clean --force

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PORT=4000
ENV NG_ALLOWED_HOSTS=localhost,127.0.0.1
WORKDIR /app

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist/apps/speak-flow ./dist/apps/speak-flow
COPY --from=build /app/dist/tools ./dist/tools

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '4000') + '/api/health').then((response) => { if (!response.ok) process.exit(1) }).catch(() => process.exit(1))"

CMD ["sh", "-c", "node dist/tools/migrate.mjs && exec node dist/apps/speak-flow/server/server.mjs"]
