FROM node:18-bullseye AS builder
RUN apt-get update && apt-get install -y \
    chromium \
    chromium-common \
    ca-certificates
RUN mkdir -p /etc/chromium.d
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
RUN npx --yes javascript-obfuscator dist --output dist

FROM zenika/alpine-chrome:with-puppeteer
WORKDIR /app

COPY --from=builder /app/dist dist
COPY --from=builder /app/node_modules node_modules

ENV NODE_ENV=production
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

CMD ["node", "dist/index.js"]