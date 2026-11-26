# Changelog

All notable changes to Sirenia are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Icon pack recipes for the AWS Architecture Icons (prefix `aws`, 804 names: service, resource, group and category icons) and the Azure architecture icons (prefix `azure`, 645 names). As for Google Cloud, the repository holds recipes, not artwork: `packs add` downloads the vendor's file, checks its pinned SHA-256 checksum and installs the icons unmodified, after you accept the vendor's terms. Each recipe has a generated list of names (`icons/aws/CATALOG.md`, `icons/azure/CATALOG.md`). Both are built by one new generator, `scripts/build-icon-pack.mjs`, which gives the ids inside each icon (gradients, clip paths, masks) names of that icon, so that icons sharing a diagram never draw each other's gradients.
- One-command start with icons: `SIRENIA_PACKS=gcp,aws,azure` with `SIRENIA_ACCEPT_PACK_TERMS=yes` makes the container install the named packs before it starts the editor. Installed packs are skipped, so a restart downloads nothing. Without the acceptance setting the container does not start and lists each vendor's terms; a failed download is logged and the editor starts without that pack.
- `packs add` takes several recipes at once (`packs add gcp aws azure`). It shows each vendor's terms and asks for each; `--accept-terms` accepts the terms of the vendors named on the command line.
- "AWS Architecture" and "Azure Architecture" examples, shown when their pack is installed.

### Changed

- "How to add an icon pack" lists each pack with its vendor, whether it is installed, and links to the vendor's icon page and terms. The commands add every pack not yet installed, starting with the one-command start.
- An export loads only the icon packs its diagram refers to into the render page, instead of every installed pack. With the Google Cloud, AWS and Azure packs installed, a small flowchart exports in about 335 ms instead of 500 ms.
- The README section "Icon packs" starts with a table of the four icon sets (Mermaid's built-in icons and the three packs), with the vendors' links and an example line for each.

## [1.6.2] - 2026-11-24

### Fixed

- A Gantt chart was tens of thousands of pixels wide in the preview when its dates were far from today (the built-in example was). The preview measured everything Mermaid draws, including the "today" line, which sits where today falls on the time axis. The preview now shows the drawing area Mermaid chose, as the export does.
- An exported Gantt chart was only 300 px wide, with labels cut off. Gantt charts are now 1200 px wide in the export and in the preview. A diagram can set another width: `%%{init: {"gantt": {"useWidth": 800}}}%%`.

### Changed

- The preview shows every diagram at the size and with the margins of the export. Small diagrams are no longer enlarged or padded to at least 400 by 300 px.

## [1.6.1] - 2026-11-23

### Fixed

- The preview no longer re-wraps the labels Mermaid has already laid out. Long labels in architecture diagrams sat on top of their icons, and words were joined ("Cloud Load Balancing" read "Cloud / LoadBalancing"); in sequence, class and other diagrams the re-wrapped text overlapped lines and boxes. Labels now have the same lines as in the export.
- Diagram text in the preview is measured and shown in the font the export uses, at the size Mermaid lays it out for (it was shown smaller). Members of a class in a class diagram no longer hang out of the left side of the box.

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
