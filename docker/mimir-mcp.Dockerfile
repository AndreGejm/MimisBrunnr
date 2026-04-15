FROM node:22-bookworm-slim AS build

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY docker ./docker
COPY documentation ./documentation
COPY runtimes ./runtimes
COPY scripts ./scripts
COPY tests ./tests
COPY .env.example ./

RUN pnpm install --frozen-lockfile
RUN pnpm build

FROM node:22-bookworm-slim AS runtime

WORKDIR /app

ENV PYTHONUNBUFFERED=1
ENV PATH="/opt/mimir-python/bin:${PATH}"

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip python3-venv \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable

COPY --from=build /app /app

RUN python3 -m venv /opt/mimir-python \
  && /opt/mimir-python/bin/pip install --no-cache-dir -r docker/mimir-mcp.requirements.txt

ENTRYPOINT ["node", "docker/mimir-mcp-session-entrypoint.mjs"]
