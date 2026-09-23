# TypeScript alpha verification

Verified locally on September 6, 2026, using Apple Silicon macOS (`arm64`) and
Node 24.18.0. Runtime implementation commit: `d0e15ffe`. Subsequent documentation
changes do not alter the tested runtime. No Windows, Linux, or Intel Mac build
was run.

## Development check

`npm run check` completed successfully:

- Generated schema type consistency and TypeScript build.
- 78 test files, 1,440 passing tests, six reported platform/private-candidate skips.
- Formatting and committed JSON stability.

The ten alpha integration tests cover local-library initialization and locks,
physical cable connectivity, one-ended terminal occupancy, invalid cores,
spare/unassigned semantics, all eight paper/orientation combinations, paired
continuation references, deterministic output, request parsing, output guards,
agent rendering, a complete 32-core paginated cable, escaped label preservation,
and field-by-field paper-setting inheritance.

The original engine, renderer golden, CLI, and guarded agent regressions remain
in the development check. The frozen private 0.2.0 tarball inventory suite is
separate under `npm run test:legacy-package`: its historical byte inventory is
not the TypeScript source-alpha distribution contract. The alpha does not claim
that the old private release artifact or protected release-evidence gate passed.

## Fresh source distribution

The source ZIP's SHA-256 and file inventory were checked. A fresh extraction
installed dependencies from the lockfile, built, initialized a local-library
cabinet project, checked its lock, validated it, queried all four cable cores,
and generated a Letter SVG. The final installation used the populated npm cache
offline; the initial cache preparation fetched missing pinned npm dependencies.

The built checkout was then moved into a directory containing spaces. Its
standalone source launcher generated a byte-identical drawing at the new path.
No global CLI installation was needed.

## Drawing inspection

The motor-starter demonstration generated seven consistently numbered Tabloid
landscape sheets. The separate cabinet demonstration shows two used and two
explicitly spare cores. Both were converted directly from their generated SVGs
to vector PDFs and visually inspected through rendered PDF pages. PDF page boxes
were checked at 1,224 by 792 points (17 by 11 inches).

These review PDFs were produced with local conversion tools; PDF generation is
not an additional bundled CLI dependency. End users can print/save the HTML
packet as PDF from their browser. The product outputs SVG, HTML, or JSON.

The browser security policy blocked opening the local HTML preview, so live
Safari/browser verification was not completed. Responsive screen styling and
physical print dimensions were checked in source/output tests. No physical
printer was tested.

## Historical release scope

At the time of this verification, this was a local source-alpha preview and
public licensing had not been selected. The current checkout now uses
[Apache-2.0](../LICENSE); see the [runtime packaging guide](RUNTIME_PACKAGE.md).
This dated record does not establish verification of later changes. Generic component libraries are present as editable project
files. Reviewed manufacturer-specific catalogs remain future work. An earlier Rust
experiment is not included in this source release.
