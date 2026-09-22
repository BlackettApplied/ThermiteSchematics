# Contributing to Thermite

The alpha is developed from source using Node 24 on Apple Silicon macOS. Clone
this repository, run `npm ci`, then `npm run build`. Use `node thermite.mjs` from
the checkout. For a quick feedback loop, run `npm test -- <affected test file>`;
run `npm run check` before submitting a change.

This project is licensed under the [Apache License 2.0](LICENSE). Before your
first pull request is merged, sign the [Contributor License Agreement](CLA.md)
by adding this line to the pull request description:

```text
I have read the CLA document and I hereby sign the CLA.
```

You keep the copyright in your contributions; the CLA is a licence, not an
assignment. Sign your commits with `git commit -s` so each carries a
`Signed-off-by` trailer. If you are contributing on behalf of a company that
holds rights in the work, contact the maintainers first so a corporate
agreement can be put in place.

## Make a reviewable change

Create a branch for one concrete problem. Include a minimal electrical JSON
example that reproduces it, the expected behavior, the implementation, and
focused verification. Generated SVG/HTML is evidence, never electrical source.
Keep source JSON and library documentation reviewable in the pull request.
Agents can use the same workflow; the human submitting a change remains
responsible for its engineering assumptions.

Avoid mixing engine changes with a machine project's electrical modifications.
A source checkout under `tools/thermite` can be its own Git repository or a pinned
submodule. Commit and submit engine changes there; keep machine design history
in the parent project. Do not automatically update that project's pinned engine.

## Electrical semantics

Preserve UUID identity, precise diagnostics, strict UTF-8/duplicate-key handling,
library byte locks, and deterministic net IDs. Only wires, jumpers, and cable
cores terminated at both ends join physical nets. A contact, coil, PLC channel,
or other device function does not automatically short its terminals. Internal
functions can describe behavior without asserting physical continuity.

Use the guarded patch workflow for existing project source and presentation:
validate, inspect, dry-run, apply, validate, render. Preserve diagnostics and
separate result/report streams. Never infer an electrical repair from a layout
problem. Test negative cases whenever changing connectivity or validation.

## Rendering

ELK owns placement and orthogonal routing; the catalog owns symbol primitives.
Sheet composition adds physical paper, title blocks, and continuation references.
Keep these concerns distinct. Preserve the original continuous SVG contract.

Inspect rendered output at its intended print size. Check cabinet names,
terminal numbers, wire labels, crossings/junctions, conductor continuations,
spare ends, and title blocks. Do not hide clipping with a smaller font or omit
conductors to make a test pass. A safe, explained R006 failure is preferable to
an incomplete drawing. Confirm both drawing flows for layout changes.

## Component library submissions

Libraries are ordinary JSON directories with `library.json` and declared type
source files. The included core library is generic, not manufacturer-certified.
A new manufacturer type should include:

- Manufacturer, exact part/order number, and hardware/document revision.
- Official source document URL, document title, and page references.
- Explicit terminal identifiers and ratings with their units.
- Function and symbol mappings with a minimal valid wiring example.
- Notes separating verified facts from unsupported or unmodeled features.
- A complete inventory of power, return, protective bonding, shield, signal and communication connections, including optional pins.
- Explicit `required: true` on universally required terminals/ports, and `connectionCoverage` with review notes. Mark incomplete models `partial`; do not claim complete coverage for a port-only device. See [connection completeness](docs/COMPLETENESS.md).

Do not copy a manufacturer's complete manual into the repository without the
necessary permission. Do not extrapolate one part's pinout to a product family.
New component IDs need renderer mappings as well as electrical definitions;
a valid library schema alone does not establish render support.

After intentional library edits, regenerate the project lock and validate.
The Siemens pilot covers selected S7-1200, ET 200SP and Comfort Panel order
numbers, with separate wiring examples for the reference-machine candidates.
Extend this through individually sourced part reviews; support for other family
members is not implied by those definitions. See the library README for the
current inventory and the limits of each model.

## Checks and releases

The normal check is the Apple Silicon source-alpha development check. It
excludes the frozen private 0.2.0 tarball inventory suite, which remains available
as `npm run test:legacy-package` on its historical source revision. Source
archives are verified separately by extracting, installing, building, and running
the alpha CLI. Some historical
private-release consumer tests intentionally skip without a downloaded release
candidate; the test output reports those skips. Protected release-evidence audits
remain separate and are not asserted by the Mac alpha check.

Keep private release controls intact. Do not publish a package, change repository
visibility, select a license, or upload machine-project data as part of a routine
fix. A source release should identify the exact commit and supported runtime.
