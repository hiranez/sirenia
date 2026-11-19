# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Report it privately through GitHub: on the repository page choose **Security**, then **Report a vulnerability**. This opens a private advisory that only the maintainers can see.

Include what you can of:

- the version or commit you tested;
- the diagram source or request that triggers the problem;
- what happens and what you expected;
- whether it needs a particular icon pack or setting.

You should get a first answer within seven days. Once a fix is ready we agree a disclosure date with you and credit you in the advisory, unless you prefer otherwise.

## What counts

Sirenia renders diagram source from people who may be hostile. These are the properties it is built to keep, and a way around any of them is a vulnerability:

- The renderer makes no outbound network request, whatever the diagram contains.
- An exported SVG or PNG contains no script, no event handler, and no reference to a resource outside the file.
- Diagram source cannot switch off the strict Mermaid settings (`securityLevel: 'strict'`, labels as SVG text).
- A request cannot read files or environment values of the server, or run code on it.
- The editor loads nothing from another origin.
- A file given to "restore" is treated as text only; it cannot run anything in the editor.
- The `packs` command downloads nothing before the terms are accepted and installs nothing whose checksum does not match.

## What does not count

- Sirenia has no login. Exposing it to a network without your own access control is a deployment decision, not a vulnerability.
- Rate limits are per server process and are meant to stop accidents, not a determined flood.
- The arbitrary-HTML render mode is off by default and is not meant for untrusted input; reports that need `ALLOW_HTML_RENDER=true` are welcome but are treated as hardening.
- An icon pack you install yourself from a file is your own input. Reports that a deliberately hostile pack can get past the loader's checks are welcome.

## Supported versions

Fixes are made on the latest release.
