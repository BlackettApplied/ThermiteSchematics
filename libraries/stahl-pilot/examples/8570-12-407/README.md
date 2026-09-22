# 8570/12-407 component check

This synthetic, unenergized fixture verifies the exact legacy plug's three power
poles and protective-earth path.
See [the component review](../../research/8570-12-407.md) for manufacturer sources,
contact naming and remaining physical-model gaps.

Run from the repository root after building:

```sh
node libraries/stahl-pilot/examples/8570-12-407/verify.mjs --isolated
```

After the full library manifest and this project's lock have been integrated:

```sh
node libraries/stahl-pilot/examples/8570-12-407/verify.mjs
```

Add `--output-dir <directory>` to save the generated `plug.svg` and diagnostic
record. All four `INTERNAL-*` jumpers represent factory continuity between cable
and mating endpoints. `C`/`M` distinguish authoring sides; the diagram is not a
physical pin layout. Installation wiring must use independently verified physical contact markings.

The test checks each path, cross-pole isolation, intentional open/short variants,
missing PE, the limitation of a floating internal PE link, renderer coverage and
library byte locking. A valid baseline intentionally has three `W904` partial-model
warnings. Connection presence never proves external bonding, adequate power or
protection.
