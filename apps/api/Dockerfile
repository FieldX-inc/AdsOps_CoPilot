FROM node:22-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json

RUN npm ci --workspace @adops/api --include-workspace-root

COPY apps/api apps/api

RUN npm --workspace @adops/api run build

FROM node:22-slim AS runtime

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json

RUN npm ci --workspace @adops/api --include-workspace-root --omit=dev \
  && npm cache clean --force

COPY --from=build /app/apps/api/dist apps/api/dist

ENV NODE_ENV=production
ENV PORT=8787

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || '8787') + '/health').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));"]

CMD ["node", "apps/api/dist/index.js"]
