# `icons/gcp` — Google Cloud icon pack for Mermaid

Official Google Cloud product icons, packaged as an [Iconify](https://iconify.design) JSON set with the
prefix **`gcp`** so Mermaid can draw them in `architecture-beta` diagrams and flowchart icon shapes.

```
icons/gcp/mapping.json            ← SOURCE OF TRUTH (edit this): base icons, products, aliases, upstream pins
scripts/build-gcp-icon-pack.mjs   ← generator (Node 22, dep: fflate); scripts/packs.mjs runs it for `packs add gcp`
icons/gcp/CATALOG.md              ← GENERATED human-readable equivalence table (icon names only, no artwork)
backend/packs/gcp.json            ← GENERATED pack bundled into the renderer image (utils/icons.js) *
frontend/public/packs/gcp.json    ← GENERATED pack, served to the editor at /packs/gcp.json *
backend/packs/index.json, frontend/public/packs/index.json ← GENERATED pack index (scripts/packs/pack-index.mjs) *
```

\* Present only in an edition that commits the pack. The open-source copy has no vendor artwork in the repository: the
pack is installed at run time (see Install).

`mapping.json`'s top-level `pack` key (label, owner, terms link, trademark notices: `notice.editor`/`editorAfter`
for the editor footer, `notice.export` for exports) is copied into the pack's `sirenia` object. After writing a
pack the generator rebuilds `index.json` in that directory from every pack there; the editor reads it to find packs.

The Google Cloud pack also carries `sirenia.catalog`, the list the editor's icon picker shows: one entry per product (`icon`, the
official `name`, and its `group`), plus the core icons that no product names. The generator checks the catalog with the same
validator that checks the pack at install time. The legacy pack has none.

## Install

The open-source copy of this repository ships no Google artwork. Add the pack yourself:

```bash
npm install                  # once, in the repository root (the generator needs fflate)
npm run packs -- add gcp     # shows Google's terms, asks you to accept them, then installs
npm run packs -- list        # what is installed where
npm run packs -- remove gcp
```

`add gcp` prints where the files are downloaded from (Google's own servers), a summary of the terms and the link
to Google's full terms, and installs nothing until you accept (type `yes`, or pass `--accept-terms` when there is no
terminal). It then downloads Google's ZIPs, checks their pinned SHA-256 checksums (a mismatch stops the install;
there is no way to skip it) and writes `gcp.json` plus the `index.json` the editor reads into `backend/packs/` and
`frontend/public/packs/` (or into the `--dir` directories, or `PACKS_DIR`). Restart the render service afterwards.
Until the pack is installed, a diagram that uses `gcp:` icons is answered with a 400 (`icon_pack_missing`) that
says how to install it. `--offline` reuses ZIPs already in `.cache/gcp-icons`.

## Regenerate (maintainers)

```bash
npm run icons:gcp            # downloads Google's ZIPs (SHA-256 pinned), rebuilds packs + catalog
npm run icons:gcp:check      # CI gate: committed outputs == generated outputs (editions that commit the pack)
node scripts/build-gcp-icon-pack.mjs --legacy   # also emit the deprecated gcp-legacy pack (migration only)
node scripts/build-gcp-icon-pack.mjs --offline  # reuse ./.cache/gcp-icons, no network
```

A **sha256 mismatch** means Google republished the ZIP in place (they do; `cache-control: max-age=1800`,
no ETag). Download the new ZIPs, diff the SVGs, update `upstream.zips.*.sha256` + the products that
changed in `mapping.json`, bump `version`, regenerate, commit. The weekly `gcp-icons-upstream` workflow opens
an issue when this happens.

## Mapping rules (from Google's May-2026 icon guide)

- A **core** product (`kind: core`) has its own 4-color icon. Everything else uses its **category** icon
  (2-color) — one category per product. Google's guide is authoritative; `source: guide` entries copy it.
- `source: zip` — icon shipped in Google's ZIP but not listed in the guide (Vertex AI).
- `source: extension` — product missing from Google's guide, mapped by this project to the closest official
  category. Re-check these on every upstream update.
- `legacy` — filename in the pre-2025 console icon set, for migrating old diagrams only. Google: *"these
  icons should not be used as of 2026."*
- Every `id` and alias is lowercase kebab-case and globally unique across icons + aliases (the generator
  fails otherwise). Aliases are typing conveniences (`gcp:bq`, `gcp:iam`); labels should still use the
  official product name.

## Normalization = render-identical, nothing else

Google's SVGs are Adobe Illustrator exports. The generator only: inlines `<style>` classes as presentation
attributes (`.st1{fill:#4285f4}` → `fill="#4285f4"`, because class names collide across icons once Iconify
injects many bodies into one document), removes `id`/`data-name`/comments/`<title>`, and drops the invisible
512×512 artboard rectangle. Fills, paths and proportions are untouched. Any other construct (gradients,
clip-paths, masks, `<use>`, external refs, scripts) fails the build — review before accepting.

## Usage notice (keep wherever the icons appear)

> Google Cloud and the Google Cloud product icons are trademarks of Google LLC, used here to depict Google
> Cloud products in architecture diagrams. This project is not affiliated with or endorsed by Google.

Do not recolor, restyle, crop or combine the icons, do not use them outside diagrams (UI chrome, marketing,
logos), and do not ship the legacy pack to production.

These are the rules the recipe follows: the artwork comes only from Google's official ZIPs, pinned by checksum;
it is not altered beyond the render-identical normalization above; products carry their official names; icons
appear only inside diagrams, with the notice above kept with them; and legacy icons are for migration only.
