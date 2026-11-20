# Changelog

All notable changes to Sirenia are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- README: the quick start runs the published image; building from source is described after it.

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
