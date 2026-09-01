FROM node:22-bookworm

ENV DEBIAN_FRONTEND=noninteractive
WORKDIR /workspace/SurfaceTrace

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ca-certificates \
    curl \
    bash \
    build-essential \
    python3 \
    jq \
    procps \
    openssl \
  && rm -rf /var/lib/apt/lists/*

# Keep npm output predictable in containers.
ENV npm_config_update_notifier=false \
    npm_config_fund=false \
    npm_config_audit=false

COPY package.json package-lock.json .npmrc ./
COPY packages/core/package.json packages/core/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/web/package.json packages/web/package.json
RUN npm ci \
  && sha256sum package-lock.json | cut -d ' ' -f 1 > node_modules/.surfacetrace-lock-sha256

COPY . .

CMD ["bash", "scripts/container-start.sh"]
