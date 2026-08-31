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

CMD ["bash"]
