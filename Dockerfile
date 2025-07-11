FROM ghcr.io/joshstevens19/rindexer-bundled:latest

RUN apt-get update \
    && apt-get install -y unzip \
    && apt-get autoremove --yes \
    && apt-get clean --yes \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://bun.sh/install | bash

# Add bun to PATH
ENV PATH="/root/.bun/bin:$PATH"

ENTRYPOINT []