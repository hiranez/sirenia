# Notices

Sirenia

Copyright 2026 Hiram Sanchez

## Licence

The source code of this software is licensed under the Apache License, Version 2.0 (see `LICENSE`).
That licence does not cover the third-party assets and trademarks described below, which remain
subject to their owners' terms.

## Icon packs

This repository and the container image built from it contain no vendor artwork. They contain
recipes (`icons/<name>/mapping.json`): the address where a vendor publishes its icons, the SHA-256
checksums of those files, and a summary of the vendor's terms. The `packs add` command shows those
terms, asks for acceptance, and then downloads the artwork from the vendor to the machine it runs on.

A person or organisation that installs a pack, or distributes a build that bundles one, is
responsible for complying with the vendor's terms.

## Google Cloud product icons

The `gcp` recipe installs the official **Google Cloud product icons** from the files Google
publishes at <https://cloud.google.com/icons> for building architecture diagrams. The icons are
installed unmodified: only render-identical normalization is applied (see `icons/gcp/README.md`);
colors, shapes and proportions are Google's.

> Google Cloud and the Google Cloud product icons are trademarks of Google LLC, used solely to
> depict Google Cloud products in architecture diagrams. Sirenia is an independent project, not
> affiliated with, sponsored by, or endorsed by Google. The icons are not licensed for any other
> use by this software's users; Google's trademark guidelines apply:
> <https://about.google/brand-resource-center/>.

Every exported SVG/PNG that uses these icons carries a notice in its metadata (`Disclaimer`).
Exports containing Google Cloud icons must not be modified to recolor, distort or crop the icons,
used as logos, or presented in a way that implies Google's endorsement.

Google periodically retires icons; the recipe tracks Google's current set (checksums pinned in
`icons/gcp/mapping.json`). Legacy console icons (pre-2025) are intentionally not installed.

## Mermaid

Diagrams are rendered with [Mermaid](https://mermaid.js.org) (MIT License, © Knut Sveidqvist and
contributors). Mermaid is bundled into the image and the web editor; no CDN is used. Sirenia is an
independent project and is not affiliated with or endorsed by the Mermaid project.

## Container image

The image also contains Node.js, Debian packages, fonts, and Chrome for Testing, each under its own
licence. Their licence texts are inside the image (`/usr/share/doc/*/copyright`, the `LICENSE` files
of the packages under `node_modules`, and Chrome's own credits).

## Other dependencies

Runtime dependencies are listed in `backend/package.json` and `frontend/package.json` with their
own licenses (`npm ls --omit=dev` in each directory). CI allows only licences on the list in
`scripts/licenses/policy.json`.
