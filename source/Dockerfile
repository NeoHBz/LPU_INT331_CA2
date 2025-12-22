# Use alpine-chrome directly (it already has Node.js and Chromium)
FROM zenika/alpine-chrome:with-puppeteer
WORKDIR /app

# 1. Switch to root to install system packages and Bun
USER root

# Install Bun (used for dependency install)
RUN apk add --no-cache curl bash && \
    curl -fsSL https://bun.sh/install | bash && \
    ln -s /root/.bun/bin/bun /usr/local/bin/bun

# Copy package files first (for caching)
# Wildcard ensures it won't fail if bun.lockb is missing
COPY package.json bun.lock* ./

# Install production dependencies using Bun
RUN bun install --production --frozen-lockfile

# Copy pre-built application
COPY dist/ ./dist/

# 2. Fix permissions so the 'chrome' user can access /app
RUN chown -R chrome:chrome /app

# 3. Switch back to chrome user for security
USER chrome

ENV NODE_ENV=production
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

CMD ["node", "dist/index.js"]