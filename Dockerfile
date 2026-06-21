# syntax=docker/dockerfile:1

# ── Builder: install deps (incl. native modules) ─────────────────────────────
FROM node:22-bookworm AS builder
WORKDIR /app

# Install dependencies first for better layer caching.
COPY package.json package-lock.json* ./
RUN npm ci

# Copy source. Typechecking is intentionally NOT run here — it is a CI gate
# (see .github/workflows/ci.yml). Running `tsc` during the image build is
# unnecessary for a tsx-based runtime and can crash V8's JIT under some
# virtualized Docker hosts (exit 133).
COPY tsconfig.json ./
COPY src ./src
COPY deploy-commands.ts ./

# ── Runtime: slim image with built node_modules, no build toolchain ───────────
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Audio is offloaded to Lavalink, so the bot image needs no ffmpeg/opus — just
# the built node_modules (better-sqlite3 is the only native dep).
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
