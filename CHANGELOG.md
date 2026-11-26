# Changelog

All notable changes to Sirenia are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Flowcharts in the Build tab. A flowchart (`flowchart` or `graph`, with any direction) opens in the builder: an outline of its subgraphs and nodes, its connections, and a quiet line that counts the lines left to the Code tab. Quick add adds a node: an icon node (`id@{ icon: "gcp:cloud-run", label: "Cloud Run" }`) when the name matches an installed pack, a rectangle (`id["Label"]`) otherwise, into the selected subgraph. "Add node", "Add subgraph", "Connect" and a "Direction" control (top to bottom, bottom to top, left to right, right to left) are in the toolbar. Forms edit a node's label, shape (Rectangle, Rounded, Stadium, Subroutine, Cylinder, Circle, Double circle, Diamond, Hexagon, the parallelograms and trapezoids, Flag), icon and subgraph; a subgraph's title and place; a connection's ends, label and line (arrow, line, dotted, thick). Deleting a node in the middle of a chain (`A --> B --> C`) splits the chain and keeps what the rest of it defines; deleting a subgraph hands its contents to its parent.
- Connect by clicking in flowcharts: select a node, press C, click the other one. The new connection is selected and its label field has the focus, ready for "Yes" or "No"; Enter writes it, Esc leaves it empty.
- Lines attached to what you delete change with it. A deleted node or subgraph leaves the `style`, `class` and `click` lines that name it, and a line that named only it is deleted; `classDef` lines are never touched. `linkStyle` numbers follow the connections they style through every edit that deletes or moves connections (deleting a node or a connection, splitting a chain, changing a connection's ends, moving a node between subgraphs); the numbers of deleted connections are dropped, and a `linkStyle` line with none left is deleted. A subgraph takes its own `direction` line with it. A line that names the item in a form the builder does not read asks for a second Delete, then goes with it. The status line says what else changed ("Deleted Start, its 2 connections and 1 style line.") and Undo restores everything. Where a number cannot be known for sure (a `linkStyle` written in a form the builder does not read, a line that may hold connections it does not read, two connections that look the same), the edit is refused with the reason.
- Markdown labels (``"`…`"``) on nodes, connections and subgraph titles are read: the item is listed and can be connected, moved and deleted; its label is edited in the Code tab.
- A connection written with `&` (`A & B --> C`) can have its label or line changed, or be deleted: that statement is first written as one statement per connection, in place, with the order of connections kept.
- Selecting connections and subgraphs in the preview: click a connection's label (or its line) or a subgraph; the line is traced over and the label outlined, as separate marks. Double-click puts the cursor in the label or title.
- Flowchart starters: "Empty flowchart", "Decision flow" (a diamond with Yes and No answers) and "Process with stages" (subgraphs for Plan, Build and Release).
- The flowchart reader works on a defined part of Mermaid's syntax: node ids with the classic bracket shapes and quoted or plain labels, `@{ icon, label }` nodes (other keys are kept), `:::class` suffixes (kept through every edit), links of every length with labels in both forms, chains, `subgraph id [Title]`, `subgraph Title` and nested subgraphs, `;` between statements and front matter, directives and comments around them. Everything else is kept byte for byte and is changed only together with what it names (see the attached lines above).

### Changed

- Labels: nothing typed is refused any more, except an empty label and a line break. The builder writes what Mermaid would otherwise read as syntax with Mermaid's character codes: `"` as `#quot;`, `<` as `#lt;`, `>` as `#gt;`, `&` as `#38;` and `#` as `#35;` where Mermaid would read a code (`&word;`, `#word;`), a leading backtick as `#96;`, the space in "direction LR" (and TB, BT, RL, TD) as `#32;`, and a colon as `#58;` after "style" or "classDef". Other text is written as typed. The outline and the forms show the text as typed. A label with many codes is measured with them, so its node is a little wider than its text.
- Rendering: character codes in labels are completed in the preview and in SVG and PNG exports. Mermaid 11 drew `#quot;` as the six characters `&quot;` and decimal codes such as `#35;` as `&#35;` in SVG labels; they now show as `"` and `#`. Only text between tags changes, only into character references (never markup), and only for code points that are characters and not controls; tags, attributes and `<style>` are left as they are, and the source embedded in an export is unchanged. This applies to every kind of diagram: class, state and ER diagram labels written with these codes now show the characters (sequence diagrams, pie charts and Gantt charts already did).
- The flowchart's direction is a row of four arrows (↓ ↑ → ←) in the toolbar, next to "Add node", "Add subgraph" and "Connect", instead of a select on a second row.
- When the text changes from outside the builder (typing in the Code tab, an example, "Restore from export…"), the Build tab's status line is cleared, connect mode ends and a pending second Delete is dropped.
- The start screen groups its starters under "Architecture diagram" and "Flowchart", and a flowchart no longer leads to it: the editor's default diagram opens in the builder.
- Labels typed in the builder are written in quotes, so punctuation stays text, and are shown exactly as typed. Runs of spaces become one space, as Mermaid shows them.
- In a flowchart, quick add offers installed packs only: Mermaid's built-in icons (cloud, database, …) belong to architecture diagrams.
- An edge label shown next to a selected outline row is readable (it lacked contrast on the green row).

## [1.8.0] - 2026-11-26

### Added

- Quick add in the Build tab: type a product or icon name and press Enter. The field searches Mermaid's built-in icons and every installed pack, lists the best matches as text (official name, pack, technical name), and adds the chosen one as a service with its official name as the label, in the selected group (or the group of the selected node). The new service is selected and the field is ready for the next, so several services can be added in a row. A name that matches nothing becomes a service with the built-in `server` icon.
- Connect by clicking: select a service or junction, press C or "Connect to…", then click the other node in the preview (or choose it in the outline and press Enter). The connection gets an arrow at the second node, and its sides follow where the two nodes are drawn (to the right: right to left; below: bottom to top; and so on). Connecting a node to itself, or two nodes that are already connected, is refused with a short message. While connecting, the preview marks the first node with a dashed outline and an arrow badge, and shows the line to the node under the pointer.
- Starters: when the editor is empty or holds another kind of diagram, the Build tab offers cards: "Empty architecture diagram", "Web application (three tiers)" with built-in icons, and one small architecture per installed pack ("Google Cloud web service", "AWS serverless web application", "Microsoft Azure web application"). Choosing one replaces the text as one undo step, after a confirmation when there is something to lose.
- Keyboard shortcuts in the Build tab, listed under "Shortcuts": `/` quick add, `C` connect, `Delete` delete the selected item (a group with nodes in it asks for a second Delete), `Esc` leave connect mode or clear the selection, Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z redo, `?` the list itself. They do not fire while you type in a field.
- Double-click a node in the preview, or press Enter on its outline row, to edit its label. The status line says what each action did and how to undo it.

### Changed

- The Build tab's toolbar fits on one row at 1280 px: quick add comes first, the four "Add…" buttons sit below it, and Undo, Redo and Shortcuts moved to the tab row.
- The selection outline in the preview is a solid green line drawn by a class (it was an inline indigo dash), visible on the white sheet in both themes. A click on a gap inside an icon now selects that node instead of the group around it.
- A label that starts and ends with quotes is refused: Mermaid would drop the quotes.
- An empty editor shows "Nothing to draw yet" in the preview instead of a "Rendering failed" error.

## [1.7.0] - 2026-11-26

### Added

- Icon pack recipes for the AWS Architecture Icons (prefix `aws`, 804 names: service, resource, group and category icons) and the Azure architecture icons (prefix `azure`, 644 names). As for Google Cloud, the repository holds recipes, not artwork: `packs add` downloads the vendor's file, checks its pinned SHA-256 checksum and installs the icons unmodified, after you accept the vendor's terms. Each recipe has a generated list of names (`icons/aws/CATALOG.md`, `icons/azure/CATALOG.md`). Both are built by one new generator, `scripts/build-icon-pack.mjs`, which gives the ids inside each icon (gradients, clip paths, masks) names of that icon, so that icons sharing a diagram never draw each other's gradients.
- One-command start with icons: `SIRENIA_PACKS=gcp,aws,azure` with `SIRENIA_ACCEPT_PACK_TERMS=yes` makes the container install the named packs before it starts the editor. Installed packs are skipped, so a restart downloads nothing. Without the acceptance setting the container does not start and lists each vendor's terms; a failed download is logged and the editor starts without that pack.
- `packs add` takes several recipes at once (`packs add gcp aws azure`). It shows each vendor's terms and asks for each; `--accept-terms` accepts the terms of the vendors named on the command line.
- "AWS Architecture" and "Azure Architecture" examples, shown when their pack is installed.

### Changed

- A new look for the editor: warm paper colours, the code and the preview on cards, a monospace interface font (JetBrains Mono, bundled with the editor; nothing is loaded from another site), and buttons with a hard drop shadow; "Download Secure Image" is the one green button. Code and Build are pill tabs. The diagram sits on a white sheet on a faint grid, exactly as it exports; diagram text keeps the export's font (Arial).
- Dark theme. The editor follows the system's light or dark setting from the first paint; a button in the top bar switches between them for the open page. The choice is not stored. The diagram stays on a white sheet in both themes.
- The render engine's state is a pill in the top bar ("Engine ready", "Engine waking…", with the full sentence as its tooltip), and the preview's state a "Ready" or "Error" pill.
- Errors (diagram, export, restore from an export) are pink cards with a title that says what failed ("Mermaid syntax error", "Rendering failed", "Export failed", "Restore from export failed", "No Mermaid metadata found"), followed by the details.
- In the Build tab, the outline shows the kind of each item as a small label (group, service, junction), and form fields have their labels above them.
- The code field no longer underlines words as spelling mistakes.
- On a phone, buttons and fields are at least 40 px high and the top bar fits the width of the screen.
- "How to add an icon pack" lists each pack with its vendor, whether it is installed, and links to the vendor's icon page and terms. The commands add every pack not yet installed, starting with the one-command start.
- An export loads only the icon packs its diagram refers to into the render page, instead of every installed pack. With the Google Cloud, AWS and Azure packs installed, a small flowchart exports in about 335 ms instead of 500 ms.
- The README section "Icon packs" starts with a table of the four icon sets (Mermaid's built-in icons and the three packs), with the vendors' links and an example line for each.

### Fixed

- An export that used a pack icon written with a dash in place of the colon (`gcp-cloud-run`, which Mermaid draws like `gcp:cloud-run`) did not carry the vendor's trademark notice. It does now, in SVG and PNG.

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
