# Pinned to a specific Puppeteer release so the bundled Chrome-for-Testing version is known,
# reproducible, and matches the npm `puppeteer` version installed below. Rebuild to pick up
# Chrome security patches. For stronger supply-chain guarantees, pin by digest in CI
# (e.g. ghcr.io/puppeteer/puppeteer:25.16.0@sha256:<digest>).
FROM ghcr.io/puppeteer/puppeteer:25.16.0

USER root
WORKDIR /usr/src/app

# Apply Debian security updates published since the base image was built (expat, pcre2,
# perl, python, ...). Chrome-for-Testing is not installed through apt, so this only patches
# system libraries.
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get upgrade -y --no-install-recommends \
 && rm -rf /var/lib/apt/lists/*

# Install production dependencies reproducibly from the lockfile. Use the browser already
# bundled in the base image instead of downloading a second copy. Puppeteer >= 19 reads
# PUPPETEER_SKIP_DOWNLOAD; the old PUPPETEER_SKIP_CHROMIUM_DOWNLOAD is ignored and made every
# build fetch an unused Chrome into /root/.cache.
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    NODE_ENV=production
COPY package.json package-lock.json ./
# Then remove the package managers: the runtime only runs `node`, and npm/corepack/yarn ship
# their own dependency trees (tar, undici, brace-expansion, ...) that scanners flag.
RUN npm ci --omit=dev --no-audit --no-fund \
 && npm cache clean --force \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
           /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-*

# Product name written into exports (see utils/branding.js); override with --build-arg.
ARG PRODUCT_NAME=Sirenia
ENV PRODUCT_NAME=$PRODUCT_NAME

# Copy application source (see .dockerignore for excluded files).
COPY . .

RUN chown -R pptruser:pptruser /usr/src/app
USER pptruser

ENV PORT=8080
EXPOSE 8080

CMD ["node", "index.js"]
