FROM node:22-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.2.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/topaz/package.json apps/topaz/
COPY libs/nest-common/package.json libs/nest-common/
COPY libs/hydrogen-kore/package.json libs/hydrogen-kore/
COPY libs/utils-parse/package.json libs/utils-parse/

RUN pnpm install --frozen-lockfile

COPY . .

RUN ENVIRONMENT=$BUILD_ENV NX_DAEMON=false pnpm nx build topaz --configuration=production

RUN pnpm --filter @universe/topaz deploy --prod /deploy


FROM node:22-alpine
WORKDIR /app

COPY --from=builder /app/dist/apps/topaz/main.js ./
COPY --from=builder /deploy/node_modules ./node_modules

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "main.js"]
