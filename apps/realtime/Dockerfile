# Socket.IO realtime service (Node 20)
FROM node:20-alpine AS base
# Prisma engines + OpenSSL on Alpine
RUN apk add --no-cache openssl libc6-compat
RUN corepack enable && corepack prepare pnpm@9.14.2 --activate
WORKDIR /app

# Monorepo: copy package manifests for workspace install.
# `database` postinstall runs `prisma generate` — schema must exist before pnpm install.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/database/package.json ./packages/database/
COPY packages/database/prisma ./packages/database/prisma
COPY apps/realtime/package.json ./apps/realtime/

RUN pnpm install --frozen-lockfile --filter realtime...

COPY packages/database ./packages/database
COPY apps/realtime ./apps/realtime

RUN pnpm --filter database exec prisma generate
ENV NODE_ENV=production
WORKDIR /app
EXPOSE 3007
CMD ["pnpm", "--filter", "realtime", "start"]
