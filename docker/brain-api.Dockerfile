FROM node:22-bookworm-slim AS build

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY documentation ./documentation
COPY tests ./tests
COPY .env.example ./

RUN pnpm install --frozen-lockfile
RUN pnpm build

FROM node:22-bookworm-slim AS runtime

WORKDIR /app

RUN corepack enable

COPY --from=build /app /app

EXPOSE 8080

CMD ["pnpm", "api"]
