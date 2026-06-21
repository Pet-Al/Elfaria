# syntax=docker/dockerfile:1

# ── Builder: install deps (incl. native modules) and typecheck ────────────────
FROM node:22-bookworm AS builder
WORKDIR /app

# Install dependencies first for better layer caching.
COPY package.json package-lock.json* ./
RUN npm ci

# Copy source and verify it typechecks as a build gate.
COPY tsconfig.json ./
COPY src ./src
COPY deploy-commands.ts ./
RUN npm run typecheck

# ── Runtime: slim image with built node_modules, no build toolchain ───────────
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# ffmpeg-static ships its own binary in node_modules, so no apt ffmpeg needed.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/src ./src
COPY --from=builder /app/deploy-commands.ts ./deploy-commands.ts

# Writable data dir for the SQLite file (mount a volume here in compose).
RUN mkdir -p /app/data && chown -R node:node /app
USER node

# Runs via tsx (TypeScript directly). See package.json "start".
CMD ["npm", "start"]
