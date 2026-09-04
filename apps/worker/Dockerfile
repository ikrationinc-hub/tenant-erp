# Built from the repo root: docker build -f apps/worker/Dockerfile .
FROM node:22-bookworm-slim

# C-2 (docs/CONTRACT-MODULE-BUILD.md): DOCX->PDF conversion runs here, via
# LibreOffice headless (never in the API process). libreoffice-writer-nogui
# is the headless-server variant (~28MB, no GUI deps) rather than the full
# libreoffice-writer package. fonts-liberation is installed explicitly -
# it's metric-compatible with Arial/Times New Roman, and without it,
# substituted fonts silently break pagination/layout between the DOCX and
# its converted PDF (the exact "do these match" risk this spike exists to
# retire).
RUN apt-get update && apt-get install -y --no-install-recommends \
      libreoffice-writer-nogui fonts-liberation \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

RUN corepack enable
WORKDIR /repo

COPY . .
RUN pnpm install --frozen-lockfile --filter=@ikration/worker...
RUN pnpm --filter=@ikration/worker build

WORKDIR /repo/apps/worker
ENV NODE_ENV=production
CMD ["node", "dist/worker.js"]
