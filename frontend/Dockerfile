# Node 22 LTS (Node 20 reached end-of-life in April 2026 and no longer gets security fixes).
# The major-version tag tracks patch releases and refreshed Debian layers on each rebuild;
# pin by digest in CI if you need byte-for-byte reproducibility.

# Stage 1: build the React application.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# Reproducible install from the lockfile (includes the proxy's runtime deps: express, axios, helmet).
RUN npm ci --no-audit --no-fund
COPY . .
# Branding file for this build (see branding/); the default is the open-source build.
ARG BRANDING_FILE=branding/default.json
ENV BRANDING_FILE=$BRANDING_FILE
RUN npm run build

# Stage 2: minimal runtime serving static files + the auth proxy.
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Apply Debian security updates published since the base image was built.
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get upgrade -y --no-install-recommends \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
# Install production deps, then remove the package managers: the runtime only runs `node`,
# and npm/corepack/yarn ship their own dependency trees that scanners flag.
RUN npm ci --omit=dev --no-audit --no-fund \
 && npm cache clean --force \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
           /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-*
COPY --from=build /app/dist ./dist
COPY auth-proxy.js upstream.js ./

# Drop privileges: run as the built-in non-root 'node' user.
USER node

# Backend base URL (https). The proxy refuses to start without it; an env var set on the service overrides it.
ARG BACKEND_URL=""
ENV BACKEND_URL=$BACKEND_URL \
    PORT=8080 \
    PROXY_PORT=8080 \
    DIST_DIR=/app/dist
EXPOSE 8080
CMD ["node", "auth-proxy.js"]
