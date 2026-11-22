# API reference

Base URL: wherever you run Sirenia, for example `http://localhost:8080`.

There is no authentication. Each client may make 20 render requests a minute by default (`RATE_LIMIT_PER_MIN`).

## Generate a diagram

`POST /api/generate`

Turns Mermaid source into a PNG or SVG file that has the source embedded in it.

### Request

```http
Content-Type: application/json
```

```json
{
  "code": "graph TD; A-->B; B-->C;",
  "output": "png"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `code` | string | yes | Mermaid source, at most 10,000 characters |
| `output` | string | no | `"png"` (default) or `"svg"` |

The request body may be at most 64 KB.

### Response

`200` with the image as the body.

| Header | Value |
|---|---|
| `Content-Type` | `image/png` or `image/svg+xml` |
| `X-Request-ID` | Identifies this render in the server log |
| `Cache-Control` | `no-store` |

### Errors

Errors are JSON: `{"error": "<message>"}`, with a `code` where a program may want to react and a `requestId` for server-side failures.

| Status | `code` | Meaning | What to do |
|---|---|---|---|
| 400 | | Missing `code`, source too long, or invalid Mermaid syntax | Fix the request |
| 400 | | `Unknown icon(s): …` | Icon names are lowercase with hyphens; use a name from the pack's catalog |
| 400 | `external_reference` | The diagram refers to an external resource | Exports must be self-contained. Remove URLs from theme CSS, font settings and image shapes. Hyperlinks on nodes (`click A href "https://…"`) are allowed |
| 400 | `icon_pack_missing` | The diagram uses a pack that has a recipe but is not installed | Install it with `packs add <prefix>` and restart the server |
| 403 | | Arbitrary-HTML rendering was requested; it is off by default | Send Mermaid source |
| 413 | | Request body over 64 KB | Send less |
| 429 | | Rate limit reached | Wait a minute, or raise `RATE_LIMIT_PER_MIN` |
| 500 | | The render failed | Retry; quote the `requestId` when reporting it |
| 502 | `upstream_unavailable` | The render service did not answer in time | Retry once; it may still be starting |
| 504 | | The render took longer than 35 seconds | Simplify the diagram |

### Examples

```bash
# PNG
curl -X POST http://localhost:8080/api/generate \
  -H 'Content-Type: application/json' \
  -d '{"code": "graph TD; A-->B;", "output": "png"}' \
  -o diagram.png

# SVG
curl -X POST http://localhost:8080/api/generate \
  -H 'Content-Type: application/json' \
  -d '{"code": "sequenceDiagram\n  A->>B: Hello", "output": "svg"}' \
  -o diagram.svg
```

```python
import requests

res = requests.post(
    "http://localhost:8080/api/generate",
    json={"code": "graph TD; A-->B;", "output": "svg"},
    timeout=120,
)
res.raise_for_status()
open("diagram.svg", "wb").write(res.content)
```

```javascript
const res = await fetch('http://localhost:8080/api/generate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ code: 'graph TD; A-->B;', output: 'png' }),
});
if (!res.ok) throw new Error((await res.json()).error);
const png = Buffer.from(await res.arrayBuffer());
```

## The source inside an export

Every export carries the diagram source, so it can be edited again. The editor's "Restore from export..." reads it back.

### SVG

A `<metadata>` element directly under the root `<svg>` holds a `<SireniaSource>` element with the source as text:

```xml
<svg xmlns="http://www.w3.org/2000/svg" …>
  …
  <metadata><SireniaSource>graph TD; A--&gt;B;</SireniaSource></metadata>
</svg>
```

```python
import xml.etree.ElementTree as ET

root = ET.parse("diagram.svg").getroot()
for metadata in root.findall("{http://www.w3.org/2000/svg}metadata"):
    for child in metadata:
        if child.tag.split("}")[-1] in ("SireniaSource", "ClonixSource"):
            print(child.text)
```

### PNG

An uncompressed `iTXt` chunk (UTF-8) with the keyword `SireniaSource` holds the source.

```python
from PIL import Image

info = Image.open("diagram.png").info
print(info.get("SireniaSource") or info.get("ClonixSource"))
```

### Older files

Files made before the project was named Sirenia use the key `ClonixSource` in the same places; the editor reads both. PNG files from the earliest versions used a Latin-1 `tEXt` chunk, which the editor also reads.

### The pack notice

An export that uses icons from a pack with a notice also carries that notice, as a `Disclaimer` entry in the same place (a second `<metadata>` element in SVG, an `iTXt` chunk in PNG). Keep it with the file.

## Health

`GET /health` answers `200 OK` when the server is up.

## Icon packs

The editor reads these from its own origin. They are listed here for completeness.

| Path | Answer |
|---|---|
| `GET /packs/index.json` | The installed packs: prefix, label, owner, terms link, editor notice, icon count. An empty list when none is installed |
| `GET /packs/<prefix>.json` | One pack, as Iconify JSON with a `sirenia` object |
