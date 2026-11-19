# Sirenia: one image for local use (Intel/AMD and ARM). The editor and the render service in one
# container, icon packs in a volume:
#
#   docker build -t sirenia .
#   docker run --rm -p 8080:8080 -v sirenia-packs:/packs sirenia
#   docker run --rm -it -v sirenia-packs:/packs sirenia packs add gcp
#
# This file is for local use only. The hosted edition is built from backend/Dockerfile and
# frontend/Dockerfile as two services; nothing here changes them.
#
# Why two processes in one container: the image runs the SAME two programs as the hosted edition,
# the proxy (frontend/auth-proxy.js) in front and the render service (backend/index.js) behind it,
# so local use goes through the same code paths, headers, rate limits and Content-Security-Policy.
# docker/entrypoint.mjs starts the render service bound to 127.0.0.1 (never reachable from outside
# the container), waits until it is healthy, then starts the proxy on $PORT with BACKEND_AUTH=none
# (no Google ID token: there is no metadata server here, and the backend is on loopback).
#
# No vendor artwork is in the image, whatever tree it is built from: no packs directory is copied,
# the editor build's dist/packs is deleted in the stage that builds it, and only the recipes'
# mapping.json and README.md are kept. Packs are installed at run time into the /packs volume by the
# explicit `packs add` command, which shows the vendor's terms first.
#
# node:22-slim is the same base and tag as frontend/Dockerfile (Node 22 LTS; the tag follows patch
# releases and refreshed Debian layers). Pin by digest if you need byte-for-byte rebuilds.

# ---- editor: the static React build ------------------------------------------------------------
FROM node:22-slim AS editor
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
# Only the editor's sources pass the root .dockerignore (no node_modules, no packs, no tests).
COPY frontend/ ./
# Branding file for this build (see frontend/branding/); the default is the open-source build.
ARG BRANDING_FILE=branding/default.json
ENV BRANDING_FILE=$BRANDING_FILE
# Vite copies public/ into dist/; whatever public/packs held in the source tree must not ship.
RUN npm run build \
 && rm -rf dist/packs

# ---- tools: the pack generator's runtime dependency, and the pack recipes -----------------------
FROM node:22-slim AS tools
WORKDIR /src
COPY package.json package-lock.json ./
# Scripts disabled and no browser download: only fflate is taken from this stage.
RUN PUPPETEER_SKIP_DOWNLOAD=true npm ci --include=dev --ignore-scripts --no-audit --no-fund
COPY icons/ ./icons/
# Recipes are text (names, checksums, terms); keep exactly mapping.json and README.md per recipe.
RUN find icons -type f ! -name mapping.json ! -name README.md -print -delete \
 && find icons -mindepth 1 -type d -empty -delete \
 && test -d node_modules/fflate

# ---- proxy-deps: the proxy's production dependencies --------------------------------------------
FROM node:22-slim AS proxy-deps
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# ---- runtime ------------------------------------------------------------------------------------
FROM node:22-slim

# Debian security updates published since the base image was built, then tini (PID 1: forwards
# signals to the launcher and reaps Chrome's helper processes) and the fonts of the official
# Puppeteer image, which the hosted render service uses, so local output matches hosted output.
# One package per line: if a name is missing from the base distribution, the build says which.
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get upgrade -y --no-install-recommends \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      tini \
      fonts-ipafont-gothic \
      fonts-wqy-zenhei \
      fonts-thai-tlwg \
      fonts-khmeros \
      fonts-kacst \
      fonts-freefont-ttf \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PUPPETEER_CACHE_DIR=/opt/chrome

# Render service dependencies from the lockfile, without Puppeteer's own download. Then Chrome for
# Testing in exactly the version the installed Puppeteer pins, installed with Puppeteer's own CLI
# (the same command the official Puppeteer image uses):
#  - it picks the build for the image's architecture (linux64 or linux-arm64), so one Dockerfile
#    serves both; Debian's chromium package would be a different, unpinned version;
#  - --install-deps installs the system libraries listed in that build's deb.deps with
#    `apt-get satisfy`, which needs root and fresh package lists (hence the apt-get update here);
#  - it runs from node_modules/.bin, so npx can never fetch a different Puppeteer;
#  - the installer unpacks Chrome with `unzip`, which the slim base lacks: installed for this step
#    only and removed again.
# /opt/chrome is written as root and made readable for the runtime user. Afterwards the package
# managers are removed as in backend/Dockerfile: the runtime only runs `node`, and npm/corepack/
# yarn ship their own dependency trees that scanners flag.
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN PUPPETEER_SKIP_DOWNLOAD=true npm ci --omit=dev --no-audit --no-fund \
 && apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends unzip \
 && ./node_modules/.bin/puppeteer browsers install chrome --install-deps \
 && chmod -R a+rX /opt/chrome \
 && DEBIAN_FRONTEND=noninteractive apt-get purge -y unzip \
 && rm -rf /var/lib/apt/lists/* \
 && npm cache clean --force \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
           /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-* /root/.npm

# Why Chrome runs with --no-sandbox (backend/routes/generate.js): Chrome's sandbox needs user
# namespaces, which Docker's default seccomp profile does not give an unprivileged container. What
# the renderer relies on instead: the page loads only the diagram (setContent) and the bundled
# Mermaid and icon packs (inline scripts); request interception aborts every request that is not
# data:, about: or blob:, so the page can reach no network and no file; Mermaid runs with
# securityLevel 'strict' and htmlLabels false, and a diagram cannot override them; arbitrary-HTML
# rendering is off (ALLOW_HTML_RENDER unset); input is capped at 10 KB and each render at 35 s. The
# container adds the outer boundary: non-root user, read-only application files, and (in
# docker-compose.yml) no capabilities and no-new-privileges.

# Application files. /app stays owned by root: the runtime user can read it, not change it.
COPY backend/index.js ./
COPY backend/routes/ ./routes/
COPY backend/utils/ ./utils/
WORKDIR /app
COPY --from=proxy-deps /src/frontend/node_modules ./frontend/node_modules
# package.json declares the proxy's files as ES modules ("type": "module").
COPY frontend/package.json frontend/auth-proxy.js frontend/upstream.js ./frontend/
COPY --from=editor /src/frontend/dist ./frontend/dist
# The packs command, its index builder, and the Google Cloud recipe's generator, which imports
# fflate (resolved from /app/node_modules) and ./packs/pack-index.mjs; the command loads the render
# service's pack validation from ../backend/utils/packFile.js.
COPY scripts/packs.mjs scripts/build-gcp-icon-pack.mjs ./scripts/
COPY scripts/packs/ ./scripts/packs/
COPY --from=tools /src/icons ./icons
COPY --from=tools /src/node_modules/fflate ./node_modules/fflate
COPY docker/entrypoint.mjs ./docker/
COPY LICENSE NOTICE.md ./

# The packs volume belongs to the runtime user: a new named volume takes this owner and mode.
RUN mkdir -p /packs \
 && chown node:node /packs

# PACKS_CACHE_DIR: the generator's download cache; /app is not writable, so it lives in /tmp.
ENV PORT=8080 \
    PACKS_DIR=/packs \
    PACK_RECIPES_DIR=/app/icons \
    PACKS_CACHE_DIR=/tmp/sirenia-packs-cache

VOLUME /packs
USER node
EXPOSE 8080

# The image has no curl; Node's fetch checks the proxy, which only starts once the render service
# is healthy (and the launcher exits, stopping the container, if either program dies).
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 8080) + '/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

LABEL org.opencontainers.image.title="Sirenia" \
      org.opencontainers.image.description="Editor and render service that turn Mermaid diagrams into self-contained SVG and PNG files, for local use. Icon packs are installed into /packs with: packs add <recipe>" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.source="https://github.com/hiranez/sirenia"

ENTRYPOINT ["tini", "--", "node", "/app/docker/entrypoint.mjs"]
CMD ["serve"]
