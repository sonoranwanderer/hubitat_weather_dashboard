FROM node:20

# Install Groovy and its Java dependency so the test harness can run the
# landing page smoke test.
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        default-jdk \
        groovy && \
    rm -rf /var/lib/apt/lists/* && \
    npm install -g npm@11.6.2

WORKDIR /workspace
