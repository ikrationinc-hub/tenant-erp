# Built from the repo root: docker build -f apps/api/Dockerfile .
# Ships the full monorepo (source + devDependencies), not just the tsup
# bundle - apps/api/scripts/*.ts (migrations, platform-admin bootstrap) run
# via tsx and need drizzle-kit/tsx present at deploy time, so pruning
# devDependencies would just mean re-adding them for that step anyway.
FROM node:22-bookworm-slim

RUN corepack enable
WORKDIR /repo

COPY . .
RUN pnpm install --frozen-lockfile --filter=@ikration/api...
RUN pnpm --filter=@ikration/api build

WORKDIR /repo/apps/api
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/server.js"]
