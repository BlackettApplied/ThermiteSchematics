# Contributing to Thermite

Thermite can be used through a prebuilt runtime package or a source checkout.
Engine improvements belong in a separate source checkout. Human and
agent-authored pull requests are welcome: fix bugs you encounter, clarify
confusing instructions, improve rendering, or add carefully sourced components.
Small, focused contributions are useful; you do not need to wait for a large
feature to be finished.

The alpha is developed from source using Bun 1.4.2 (pinned in `.bun-version`)
on macOS, Windows, and Linux. Install Python 3.12 or later for the full development
checks (`python` on Windows, `python3` elsewhere, or set
`THERMITE_RESEARCH_PYTHON`). Runtime users do not need Python. See
[platform checks](docs/PLATFORMS.md). Clone this repository, run `bun install --frozen-lockfile`,
then `bun run build`. Use `bun thermite.mjs` from the checkout. For a quick
feedback loop, run `bun run test -- <affected test file>` (not `bun test`; the
suite runs on Vitest); run `bun run check` before submitting a change. Commit
`bun.lock` changes with any dependency change; `package-lock.json` is retained
only for the frozen historical private release tooling.

This project is licensed under the [Apache License 2.0](LICENSE). Before your
first pull request is merged, sign the [Contributor License Agreement](CLA.md)
by adding this line to the pull request description:

```text
I have read the CLA document and I hereby sign the CLA.
```

The human contributor must read and accept the CLA. Agents may prepare changes
and a PR description, but must not insert an acceptance statement or represent
that they have signed for someone else. Maintainers verify acceptance before
merging; the PR template alone is not a signature.

You keep the copyright in your contributions; the CLA is a licence, not an
assignment. Add a sign-off with `git commit -s` so each commit carries a
`Signed-off-by` trailer using your real name and email in your Git configuration.
This is a commit sign-off, not a cryptographic signature or a substitute for
CLA acceptance.
If you are contributing on behalf of a company that holds rights in the work,
contact the maintainers first so a corporate
agreement can be put in place. Start with an
[issue requesting contributor contact](https://github.com/BlackettApplied/ThermiteSchematics/issues/new)
to arrange that conversation; do not include confidential agreement details.

## From local fix to pull request

1. Fork [BlackettApplied/ThermiteSchematics](https://github.com/BlackettApplied/ThermiteSchematics)
   and create a focused branch in your engine checkout. The current upstream
   default branch is `dev`; target that branch when opening the PR.
2. Reproduce the issue with shareable input, make the change, and run focused
   tests. Run `bun run check` before submitting. Rebuild before using the changed
   engine to generate your project's drawings.
3. Review the diff, sign off your commits, and push your branch to your fork.
   Open a PR describing the problem, resulting behavior, validation, and any
   remaining limitations. Identify agent assistance and third-party sources.
4. Review and accept the CLA yourself when applicable, then respond to review.
   If your agent lacks GitHub access, it can leave the patch and PR description
   ready for you to submit.

Use a small synthetic example instead of customer drawings, credentials, or
proprietary machine data. Report reproducible issues even if you cannot fix them.
When an agent finds a related improvement, keep unrelated work in a separate PR.

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

The normal check is the cross-platform source-alpha development check. It
excludes the frozen private 0.2.0 tarball inventory suite, which remains available
as `npm run test:legacy-package` on its historical source revision with its
original Node/npm toolchain. Source
archives are verified separately by extracting, installing, building, and running
the alpha CLI. Some historical
private-release consumer tests intentionally skip without a downloaded release
candidate; the test output reports those skips. Protected release-evidence audits
remain separate and are not asserted by the source-alpha check.

Run `bun run package:pack` from a clean committed tree to build and verify the
public runtime ZIP, or add `--preview` for an uncommitted local test build.
See the [runtime packaging guide](docs/RUNTIME_PACKAGE.md) and
[platform checks](docs/PLATFORMS.md) for packaging, acceptance, and verified
targets. Workspace packages
remain `private: true` to prevent accidental npm publication; that flag does not
restrict the source license.

Keep historical private release controls intact. Do not publish a package, change repository
visibility, select a license, or upload machine-project data as part of a routine
fix. Every release should identify the exact commit and supported runtime.
