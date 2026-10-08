FROM node:22-bookworm-slim AS base
WORKDIR /app
RUN --mount=type=tmpfs,target=/var/lib/apt/lists --mount=type=tmpfs,target=/var/cache/apt --mount=type=tmpfs,target=/tmp apt-get update && apt-get install -y --no-install-recommends openssl curl && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/db/package.json packages/db/package.json
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm ci && npm cache clean --force
COPY . .
RUN npm run db:generate && npm run build && rm -rf apps/web/.next/cache
ENV NODE_ENV=production
USER node
CMD ["node", "apps/api/dist/server.js"]
