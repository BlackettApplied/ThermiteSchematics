# 23D01BA05 twin pushbutton check

One `stahl-pilot:23d01ba05` operator position and a synthetic four-point boundary
demonstrate the historical contact diagram. This is an unenergized component
example, not installation wiring or a complete 8040 enclosure.

From the repository root, using the built TypeScript alpha and Node 24:

```sh
node libraries/stahl-pilot/examples/23d01ba05/verify.mjs
```

Pass an optional output directory to retain the generated SVG, diagnostics and
verification record:

```sh
node libraries/stahl-pilot/examples/23d01ba05/verify.mjs .codex-reviews/component-review/23d01ba05/verification
```

Normal verification compiles the committed example and checks its library lock.
During concurrent library authoring, add `--isolated` to compile a scratch
snapshot containing only this reviewed type and the fixture. All mutation tests
use that scratch copy. The canonical example's library lock is regenerated when
the parent library batch is integrated.

Expected checks cover four individually numbered endpoints, NC 11-12 and NO
13-14, isolation across and between contacts, no implicit ganging or fabricated
PE/lighting terminals, all four rendered wires and both pushbutton marks,
rejection of an unknown contact selection, rejection of terminal 23, omission of passive
contacts without a required-connection warning, continuity only from an authored
test jumper, and stale-byte lock rejection. Two W904 diagnostics preserve the
operator's partial physical connection coverage and the synthetic boundary's
limits.

The generated one-sheet tabloid packet is visually reviewed for terminal
numbers, NC/NO marks, all four wire labels and unclipped notes. Electrical source
is the JSON; SVG is generated evidence. The contact-to-button colour assignment,
exact clamp hardware and conditional switching capability remain unverified,
as recorded in [the component research](../../research/23d01ba05.md).

Verification completed 2026-09-11 on Node 24.18.0 / Apple Silicon macOS using
`--isolated`: all focused checks passed, with no stderr output. The generated
tabloid SVG was rasterized and visually inspected; four terminal numbers, four
wire labels, both NC/NO marks and all notes were readable and unclipped.
