# Built from the repo root: docker build -f apps/worker/Dockerfile .
FROM node:22-bookworm-slim

RUN corepack enable
WORKDIR /repo

COPY . .
RUN pnpm install --frozen-lockfile --filter=@ikration/worker...
RUN pnpm --filter=@ikration/worker build

WORKDIR /repo/apps/worker
ENV NODE_ENV=production
CMD ["node", "dist/worker.js"]
