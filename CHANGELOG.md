# Changelog

All notable changes to Sirenia are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
