# Sirenia

Sirenia turns [Mermaid](https://mermaid.js.org) diagrams into SVG and PNG files that are safe to keep and pass around: each file is self-contained, and each file carries the diagram source it was made from.

It is an editor with a live preview and a small HTTP API, in one container you run yourself.

> Sailors used to report mermaids. What they had seen were sirenians: manatees and dugongs. Sirenia is the plain, dependable animal behind the Mermaid diagram.

Sirenia is an independent project. It uses Mermaid and is not affiliated with or endorsed by the Mermaid project.

## What it does

- **The source travels with the image.** Every export has the Mermaid source embedded in it (SVG `<metadata>`, PNG text chunk). Restore an exported file in the editor and you get the diagram text back, so a picture in a wiki or a slide deck can always be edited again.
- **Exports are self-contained.** A diagram that would make the file load anything from somewhere else (an image URL, a font, a `url()` in theme CSS) is refused with a clear error. An exported file never calls out when someone opens it.
- **The renderer cannot reach the network.** Diagrams are drawn in a headless browser whose every outbound request is blocked. Mermaid and icon packs are read from local disk, never from a CDN.
- **Strict Mermaid settings.** `securityLevel: 'strict'`, labels drawn as SVG text and not HTML, and a diagram cannot switch either off from its own source.
- **Icon packs are plug-ins.** Sirenia ships no vendor artwork. You add the packs you need, for example the official Google Cloud product icons, with one command that shows you the vendor's terms first.
- **Editor and API.** Use the browser editor, or `POST /api/generate` from a script or a pipeline.

The editor has two tabs above the code. **Code** is the text editor. **Build** puts an `architecture-beta` diagram together from forms: add groups, services, junctions and connections, choose icons by name (Mermaid's built-in ones, or a pack's through the icon picker), and click a node in the preview to select it. The Mermaid text stays the only copy of the diagram: each action is a small edit of it, shown as you build, and lines the builder does not manage are kept as they are. Undo and Redo cover builder actions, icon insertions and typing. Layout stays Mermaid's, and other kinds of diagram are edited as text.

## Quick start

You need Docker.

```bash
docker run --rm -p 8080:8080 -v sirenia-packs:/packs ghcr.io/hiranez/sirenia:1.6.2
```

Open <http://localhost:8080>.

The image runs on Intel/AMD and on ARM machines (Apple Silicon included), as a non-root user. There is no `latest` tag: pin a version from the [releases](https://github.com/hiranez/sirenia/releases), each of which comes with an SBOM of the image.

To build the image yourself:

```bash
git clone https://github.com/hiranez/sirenia.git
cd sirenia
docker compose up --build
```

Without Compose:

```bash
docker build -t sirenia .
docker run --rm -p 8080:8080 -v sirenia-packs:/packs sirenia
```

To draw with a cloud provider's official icons, add an icon pack: see [Icon packs](#icon-packs).

## Icon packs

A pack is a set of icons you can use in `architecture-beta` diagrams and flowchart icon shapes, for example `service api(gcp:cloud-run)[Cloud Run]`. Without a pack, the editor draws only Mermaid's built-in icons.

Sirenia contains recipes, not artwork. A recipe knows where the vendor publishes its icons, the checksums of those files, and the vendor's terms of use. Installing a pack downloads the artwork from the vendor to your machine, after you accept those terms in the terminal.

The editor shows the same commands: open **Add an icon pack...** above the code (or next to the icon field in the Build tab) while no pack is installed. The container also prints a hint when it starts.

### With the published image

This adds the Google Cloud icons (the recipe `gcp`) to the container from the quick start.

1. In a terminal, run:

   ```bash
   docker run --rm -it -v sirenia-packs:/packs ghcr.io/hiranez/sirenia:1.6.2 packs add gcp
   ```

   It shows the vendor's terms and asks you to type `yes`. Then it downloads the icons from the vendor and checks each download against a pinned SHA-256 checksum; a mismatch stops the install.

   The `-v sirenia-packs:/packs` part must be the same volume your server was started with. With a different volume, the pack is installed where the server does not look.

2. Stop the running container and start it again with the same command as before. Packs are read when the server starts, so a restart is needed.
3. Reload the editor in the browser. The **Insert icon...** button now appears above the code, and **Choose from a pack...** next to the icon field in the Build tab.

`packs list` shows the recipes and the packs you have installed:

```bash
docker run --rm -it -v sirenia-packs:/packs ghcr.io/hiranez/sirenia:1.6.2 packs list
```

### Built from source

With Docker Compose, from the project folder:

```bash
docker compose run --rm sirenia packs add gcp
docker compose restart sirenia
```

With the image built by hand, use its name in place of the published one: `docker run --rm -it -v sirenia-packs:/packs sirenia packs add gcp`.

Without Docker, from the project folder (Node.js 22.12 or later, `npm ci` run once in the project folder):

```bash
npm run packs -- add gcp
```

Then restart the two programs, the render service and the editor's server. Reload the page afterwards.

### The recipes

| Recipe | Icons | Owner |
|---|---|---|
| `gcp` | Google Cloud product icons | Google |

### Your own icons

You can install an [Iconify](https://iconify.design) JSON file of your own with `packs add --file my-icons.json`. Packs are checked when they are loaded: icons that contain scripts, embedded documents or references to anything outside the file are rejected. You are responsible for having the right to use the artwork you install.

### In the editor

With a pack installed, the editor shows an "Insert icon..." button above the code. It opens a searchable list of the pack's icons by their official product names, previews the selected one in a small diagram, and adds it to an architecture or flowchart diagram at the cursor. The list is text only: the icon is drawn only inside a diagram, unmodified, with its official name as the label. A pack lists these names in the optional `sirenia.catalog` key of its file, an array of `{ "icon", "name", "group" }` entries (`group` is optional; names may not contain characters that have a meaning in Mermaid syntax). Without a catalog the list falls back to the pack's icon names.

Vendor icons are trademarks of their owners and are not covered by Sirenia's licence. See [NOTICE.md](NOTICE.md).

## API

```bash
curl -X POST http://localhost:8080/api/generate \
  -H 'Content-Type: application/json' \
  -d '{"code": "graph TD; A-->B;", "output": "svg"}' \
  -o diagram.svg
```

| Field | Values | Default |
|---|---|---|
| `code` | Mermaid source, at most 10,000 characters | required |
| `output` | `png` or `svg` | `png` |

The answer is the image. Errors are JSON with an `error` message and, where a program may want to react, a `code`:

| Status | `code` | Meaning |
|---|---|---|
| 400 | | Invalid diagram, unknown icon name, or a bad request |
| 400 | `external_reference` | The diagram refers to an external resource; exports must be self-contained |
| 400 | `icon_pack_missing` | The diagram uses a pack that is not installed |
| 413 | | Request body over 64 KB |
| 429 | | Rate limit reached (20 requests a minute for each client by default) |
| 502 | `upstream_unavailable` | The render service did not answer in time |

The full reference is in [docs/API.md](docs/API.md).

## Configuration

Set these as environment variables on the container.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | Port the server listens on |
| `PACKS_DIR` | `/packs` | Directory that holds the installed icon packs |
| `RATE_LIMIT_PER_MIN` | `20` | Render requests allowed for each client in a minute |
| `PRODUCT_NAME` | `Sirenia` | Name written into the notice that travels with pack icons |

The name and contact details shown in the editor are chosen when the editor is built, from a branding file (`frontend/branding/`, build argument `BRANDING_FILE`). An edition built from Sirenia can set `basedOn` (a name and an https link) in its branding file; the editor then says in its footer which project it is based on.

## How it is put together

```
browser ──► proxy (serves the editor, rate limit, security headers)
                │  loopback only
                ▼
           render service ──► headless Chrome, all network blocked
                │
                ▼
           /packs (icon packs, read from disk at start)
```

- `frontend/`: the editor (React, Vite) and the proxy that serves it.
- `backend/`: the render service (Express, Puppeteer).
- `icons/`: pack recipes. `scripts/packs.mjs`: the `packs` command.
- `scripts/security/verify-invariants.mjs`: the checks that keep the security settings from drifting. They run in CI, some against the built image.

## Development

Node.js 22.12 or later.

```bash
cd backend && npm ci && npm test
cd frontend && npm ci && npm test && npm run build
node scripts/security/verify-invariants.mjs static
```

Run the two parts from source, with the editor on port 8080:

```bash
node docker/entrypoint.mjs serve
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

Please report vulnerabilities privately; see [SECURITY.md](SECURITY.md).

Sirenia is built to render diagrams from people you do not fully trust, but it has no login of its own. If you expose it beyond your own machine, put it behind your own access control.

## Editions

Sirenia is the open-source project. Clonix Secure Diagram Studio is a hosted edition operated by Clonix; it is built from Sirenia, says so in its footer, and bundles icon packs.

## Trademarks

Google Cloud and the Google Cloud product icons are trademarks of Google LLC. The `gcp` recipe lets you install them to depict Google Cloud products in architecture diagrams, under Google's terms. Sirenia is an independent project, not affiliated with, sponsored by, or endorsed by Google.

Mermaid is a project of its own authors and contributors. All other trademarks belong to their owners.

## Licence

Copyright 2026 Hiram Sanchez

Licensed under the [Apache License, Version 2.0](LICENSE). The licence covers the source code. It does not cover icon packs or any trademark; see [NOTICE.md](NOTICE.md).

Sirenia was created by Hiram Sanchez.
