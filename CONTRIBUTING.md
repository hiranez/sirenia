# Contributing to Sirenia

Thank you for considering a contribution. Bug reports, fixes, documentation and new pack recipes are all welcome.

## Before you start

- For anything larger than a small fix, open an issue first and describe what you want to change. It saves you from building something that cannot be merged.
- Security problems go through the private channel in [SECURITY.md](SECURITY.md), not through issues.
- By contributing you agree that your contribution is licensed under the Apache License, Version 2.0, as section 5 of the licence describes. Only submit work you have the right to submit.

## Set-up

Node.js 22.12 or later. Docker if you want to build the image.

```bash
cd backend && npm ci && npm test
cd ../frontend && npm ci && npm test && npm run build
cd .. && npm ci --ignore-scripts
node scripts/security/verify-invariants.mjs static
node --test scripts/packs.test.mjs docker/entrypoint.test.mjs
```

Run it from source:

```bash
node docker/entrypoint.mjs serve
```

## Rules that a change must keep

These are checked in CI, most of them by `scripts/security/verify-invariants.mjs`. A pull request that weakens one of them needs a very good reason and will be discussed before review.

1. The renderer makes no network request. Mermaid and icon packs are read from disk.
2. Mermaid runs with `securityLevel: 'strict'` and root-level `htmlLabels: false`, in the renderer and in the editor, and a diagram cannot override either.
3. Exports are self-contained. Anything that would make an exported file load an external resource is refused.
4. The editor's Content-Security-Policy stays same-origin only.
5. No vendor artwork in the repository or the image. Icons arrive through a recipe and the `packs` command.
6. Dependencies: `npm audit --omit=dev --audit-level=high` passes, lockfiles are in sync (`npm ci` works), and licences are on the list in `scripts/licenses/policy.json`.
7. Every GitHub Action is pinned to a full commit SHA. No `:latest` image tags.

One trap worth knowing: a JavaScript regular expression with the `g` flag keeps state between calls. Never share one across requests; build a new one for each call.

## Pull requests

- One change per pull request, on a branch from `main`.
- Describe **what** changed, **why**, and **how you verified it**.
- Add or update tests. Update `CHANGELOG.md` under "Unreleased".
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org) (`feat:`, `fix:`, `docs:`, `ci:`).

## Adding a pack recipe

A recipe lives in `icons/<name>/` and consists of a `mapping.json` and a generator script. Before proposing one, check that the vendor's terms allow its icons to be used in architecture diagrams and say so in the pull request, with a link.

A recipe must:

- download only from the vendor's own published location, with every file pinned by SHA-256;
- leave the artwork visually unmodified;
- name products by their official names;
- carry the vendor's terms summary, the link to the full terms, and the notice text for the editor and for exports (`pack` in `mapping.json`; see `icons/gcp/` for a complete example);
- commit no artwork.

## Conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
