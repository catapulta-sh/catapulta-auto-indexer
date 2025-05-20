FROM oven/bun:latest

# Update packages
RUN apt-get update

# Get Ubuntu packages
RUN apt-get install -y build-essential curl git unzip procps

# Get Rust
RUN curl https://sh.rustup.rs -sSf | bash -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"


# Install foundry
RUN curl -L https://foundry.paradigm.xyz | bash
ENV PATH="/root/.foundry/bin:${PATH}"
RUN foundryup

# Install rindexer
RUN mkdir -p /root/.rindexer

RUN curl -L https://rindexer.xyz/releases/resources.zip -o /root/.rindexer/resources.zip && \
    mkdir -p /root/.rindexer/resources && \
    unzip -o /root/.rindexer/resources.zip -d /root/.rindexer/resources

# Download, modify, and run the install script
RUN curl -L https://rindexer.xyz/install.sh -o rindexer_install.sh && \
    chmod +x rindexer_install.sh && \
    sed -i 's/curl -sSf -L "$RESOURCES_URL" -o "$RINDEXER_DIR\/resources.zip" & spinner "Downloading resources..."/echo "Skip downloading resources - already downloaded"/' rindexer_install.sh && \
    bash -x ./rindexer_install.sh && \
    rm rindexer_install.sh