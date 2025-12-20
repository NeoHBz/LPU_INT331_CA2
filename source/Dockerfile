# syntax=docker/dockerfile:1

# Use alpine-chrome directly (it already has Node.js and Chromium)
FROM zenika/alpine-chrome:with-puppeteer
WORKDIR /app

# Copy package files first (for caching)
COPY package*.json ./

# Install production dependencies with cache mount
# This layer is cached unless package.json changes
RUN --mount=type=cache,target=/root/.npm \
    if [ -f package-lock.json ]; then \
        npm ci --omit=dev; \
    else \
        npm install --production; \
    fi

# Copy pre-built application (changes frequently, so do last)
COPY dist/ ./dist/

ENV NODE_ENV=production
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

CMD ["node", "dist/index.js"]