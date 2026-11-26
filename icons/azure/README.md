# `icons/azure`: the Microsoft Azure icon pack recipe

The recipe for the official **Azure architecture icons**, as an [Iconify](https://iconify.design) pack with the prefix
**`azure`**, for `architecture-beta` diagrams and flowchart icon shapes: `service vm(azure:virtual-machine)[Virtual Machine]`.

This directory holds no artwork. `packs add azure` downloads Microsoft's icon ZIP from Microsoft, after you accept
Microsoft's terms.

```
icons/azure/mapping.json          the recipe: Microsoft's ZIP (SHA-256 pinned), category names, terms, notices
icons/azure/CATALOG.md            GENERATED list of the icon names (no artwork)
scripts/build-icon-pack.mjs       the generator, shared with the AWS recipe
```

## Source and terms

- Icons and terms: <https://learn.microsoft.com/en-us/azure/architecture/icons/>, "Azure Public Service Icons V25"
  (November 2026 update).
- Microsoft's terms on that page: "Microsoft permits the use of these icons in architectural diagrams, training
  materials, or documentation. You can copy, distribute, and display the icons only for the permitted use unless
  granted explicit permission by Microsoft. Microsoft reserves all other rights."
- Do's and don'ts on the same page: use the icons to illustrate how products work together, with the product name
  close to the icon; don't crop, flip or rotate them; don't distort or change their shape; don't use Microsoft product
  icons to represent your own product or service.
- Microsoft Trademark and Brand Guidelines: <https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks>.

The summary that `packs add azure` shows is in `mapping.json` (`pack.terms`); Microsoft's own terms prevail over it.

## What the pack contains

Every service icon in the ZIP (one size: the icons are vector files on an 18 x 18 grid). Microsoft files some icons in
several categories; each is taken once, in the first category of the order in `groups`. Names whose drawing is the same
as another's are aliases of it.

## Names

A key is the name in the file name in kebab-case (`10021-icon-service-Virtual-Machine.svg` → `azure:virtual-machine`),
and the name the editor shows is that name with spaces (`Virtual Machine`). Where Microsoft gives two different icons
the same name, the second one's key ends in Microsoft's file number (`azure:workspaces-00400`); CATALOG.md lists them.
`overrides` in `mapping.json` corrects the few file names that misspell a name. Label each icon with its name.

## Normalization: render-identical only

As for the AWS recipe (see `icons/aws/README.md`): file metadata goes, `<style>` class rules are written onto their
elements, and referenced ids (Microsoft's icons use gradients throughout) get names that belong to the icon, so that
icons sharing one diagram never draw each other's gradients. Colours, shapes and proportions are Microsoft's.

## Regenerate (maintainers)

```bash
npm ci                         # once: the generator needs fflate
npm run icons:azure            # downloads Microsoft's ZIP, checks it, rewrites CATALOG.md; the pack goes to .cache/packs
npm run icons:azure -- --check # CATALOG.md and that pack match the recipe
```

A **SHA-256 mismatch** means Microsoft changed the ZIP behind the URL (the URL names a version, `V25`, but a file can be
replaced in place). Nothing is installed. Review the new icons, update `upstream.zips.icons` (url, sha256), `version`,
`groups` (the generator fails on a category it does not know) and `overrides`, regenerate and commit. The weekly
`gcp-icons-upstream` workflow checks the pin.
