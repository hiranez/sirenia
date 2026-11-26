# `icons/aws`: the AWS icon pack recipe

The recipe for the official **AWS Architecture Icons**, as an [Iconify](https://iconify.design) pack with the prefix
**`aws`**, for `architecture-beta` diagrams and flowchart icon shapes: `service web(aws:amazon-ec2)[Amazon EC2]`.

This directory holds no artwork. `packs add aws` downloads AWS's icon package from AWS, after you accept AWS's terms.

```
icons/aws/mapping.json            the recipe: AWS's ZIP (SHA-256 pinned), which files become icons, category names, terms, notices
icons/aws/CATALOG.md              GENERATED list of the icon names (no artwork)
scripts/build-icon-pack.mjs       the generator, shared with the Microsoft Azure recipe
```

## Source and terms

- Icons: <https://aws.amazon.com/architecture/icons/>, the "Icon package" of 31 July 2026. AWS publishes a new package
  each quarter except the fourth.
- AWS's page says: "We allow customers and partners to use these toolkits and assets to create architecture diagrams."
- AWS Trademark Guidelines: <https://aws.amazon.com/trademark-guidelines/>.

The summary that `packs add aws` shows is in `mapping.json` (`pack.terms`); AWS's own terms prevail over it.

## What the pack contains

The package has each service icon in four sizes (16, 32, 48 and 64 px) and some icons in a variant for dark
backgrounds. The pack takes one version of each icon:

- **Service icons**: the 64 px version (the largest; Mermaid draws icons 80 px wide).
- **Resource icons** (EC2 instance, S3 bucket, Lambda function and so on): the only size AWS publishes, 48 px.
- **Group icons** (AWS Cloud, Region, VPC, subnets): for `group` lines. The AWS Cloud group icon that contains the AWS
  logo is left out; the one without the logo is in.
- **Category icons**: one per AWS category.

Dark-background variants are left out. A service AWS files in two categories, with a different colour in each, is
taken from the first category; CATALOG.md lists what was left out and why.

## Names

A key is the file name in kebab-case (`Arch_Amazon-EC2_64.svg` → `aws:amazon-ec2`), and the name the editor shows is
the file name with spaces (`Amazon EC2`). Where a file name cannot carry the official spelling (hyphens, parentheses, a
colon), `overrides` in `mapping.json` gives the name; the key stays the one from the file name. Two names with the same
drawing share it (one is an alias). Label each icon with its name.

## Normalization: render-identical only

The SVG files are not changed in any way that shows. The generator drops the file's metadata (title, comments, ids that
nothing refers to), writes `<style>` class rules onto the elements they style, and gives the ids that are referenced
(gradients, clip paths, masks) names that belong to the icon. That last step matters because many icons share one SVG
document in a diagram, where two icons with the same id would draw each other's gradients. Colours, shapes and
proportions are AWS's. Anything the generator does not understand fails the build.

## Regenerate (maintainers)

```bash
npm ci                       # once: the generator needs fflate
npm run icons:aws            # downloads AWS's ZIP, checks it, rewrites CATALOG.md; the pack goes to .cache/packs (not committed)
npm run icons:aws -- --check # CATALOG.md and that pack match the recipe
```

A **SHA-256 mismatch** means AWS changed the file behind the URL. Nothing is installed. Download the new package,
review the icons, update `upstream.zips.icons` (url, sha256), `version` and the paths in `overrides` and `exclude`
(they name the release folder), regenerate and commit. The weekly `gcp-icons-upstream` workflow checks the pin.
