# Wiser Workspace app + Home Assistant integration listener (one process: `node server.js`).
# Multi-arch base image: builds natively on a Raspberry Pi (arm64/armv7) and on x86.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.js jsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY *.js ./
COPY src ./src
COPY --from=build /app/dist ./dist
# Mappings, layout and encrypted credentials live in /app/data; mount a volume there.
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
CMD ["node", "server.js"]
