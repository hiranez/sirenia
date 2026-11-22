# Changelog

All notable changes to Sirenia are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.6.0] - 2026-11-22

### Changed

- New editor layout: a top bar holds the product name, an "Examples" menu, "Restore from export...", the SVG or PNG choice, the download button and an "About" button, so the code field and the visual builder use the full height of the window. The feature list, the API note and the contact details moved into an About dialog. The privacy line, the icon pack notices and the "based on" credit stay in a footer at the bottom of the page. Export progress, the "downloaded" message and export errors appear under the download button instead of in the editor column.

### Fixed

- The API note in the editor showed the example diagram as `A--&gt;B;`; it now reads `A-->B;`.

## [1.5.0] - 2026-11-21

### Added

- Visual builder for architecture diagrams: a "Build" tab next to the code ("Code" stays the default) adds and edits groups, services, junctions and connections with forms, from an outline of the diagram. Icons are chosen by name: Mermaid's built-in ones, or a pack's through the icon picker, which has a choosing mode for this. Clicking a service, group or junction in the preview selects it; the selection is an outline drawn around the node, never a change to its icon. The Mermaid text remains the only copy of the diagram: every action is a minimal edit of it, lines the builder does not manage (and comments, blank lines, line endings) are kept byte for byte, and edits Mermaid would reject (a group inside itself, a parent group defined after its child, a second connection between the same two nodes) are refused with a message. Other diagram kinds are left to the Code tab.
- Undo and Redo in the builder, over builder actions, icon insertions and typing in the code field (a burst of typing is one step).
- "How to add an icon pack" in the editor: a dialog with the recipes this installation offers (installed or not) and the exact commands for the published image, Docker Compose and a source checkout, each with a Copy button. It opens from "Add an icon pack..." above the code and next to the icon field in the Build tab (shown while no pack is installed), from the "add an icon pack" link in the Features list, and from "Add another pack..." in the icon picker. It is offered only where recipes exist; a hosted edition that bundles its packs shows none of it.
- `GET /pack-recipes.json` on the front door: the recipes the installation offers (prefix, label, owner) and, when there are any, the version; read once at start from `PACK_RECIPES_DIR`, otherwise from `icons/` next to the frontend directory.
- The container prints a line after "Ready on port ...": the installed packs, or, with none, the command that adds one.

### Fixed

- README, "Icon packs": a numbered walk-through for the published image (the full command, restart, reload, what appears in the editor), then the Compose and from-source variants. It no longer asks the reader to substitute an image name by hand, and the quick start points to it.
- The built-in "Google Cloud Architecture" example names its network group by the catalog entry, "Virtual Private Cloud" (`gcp:virtual-private-cloud`), instead of "VPC" (`gcp:vpc`).
- A wide diagram no longer squeezes the sidebar on narrow windows (the preview scrolls instead), and the sidebar scrolls on its own, so the preview stays in view.

## [1.4.0] - 2026-11-20

### Added

- Icon picker: with a pack installed, "Insert icon..." in the editor opens a searchable list of the pack's icons by official product name, previews the selected one in a one-node diagram, and inserts it into an architecture or flowchart diagram at the cursor, or copies its `prefix:icon` name. The list is text only; icons appear only inside diagrams.
- Optional `sirenia.catalog` key in pack files: an array of `{ icon, name, group }` entries naming the icons (at most 5000). The Google Cloud pack carries one. A pack without a catalog still works; the picker lists its icon names. A pack that contains a catalog is rejected by Sirenia 1.3.0 and older, whose validator refuses unknown `sirenia` keys: upgrade first, then reinstall packs, not the other way round.

## [1.3.0] - 2026-11-20

### Added

- Branding key `basedOn` (a name and an https link): an edition built from Sirenia can name the project it is based on in the editor footer.

### Changed

- README: the quick start runs the published image; building from source is described after it.
- This repository is now where Sirenia is developed. Its CI no longer contains the steps that built it from another tree, and it checks on its own that it holds no vendor artwork and no deployment files.
- The release workflow publishes only from this repository, so an edition that carries the file does not publish an image by tagging a version.
- The repository scan fails when documentation names the published image at a version other than the one in `package.json`.

## [1.2.0] - 2026-11-19

First public release of the project as open source.

### Added

- Editor with live preview and export to SVG and PNG.
- `POST /api/generate`.
- The diagram source embedded in every export, and "Restore from Exported SVG or PNG" in the editor.
- Self-contained exports: a diagram that refers to an external resource is refused (`external_reference`).
- A renderer with all outbound network access blocked, strict Mermaid settings, and CI checks that keep both from drifting.
- Icon packs as plug-ins, with the `packs` command (`list`, `add`, `remove`) and a recipe for the Google Cloud product icons. No vendor artwork is shipped.
- One container image for local use, for Intel/AMD and ARM machines.
