# Machine alpha verification

Verified September 6, 2026 on Apple Silicon macOS / Node v24.18.0.
These historical measurements describe the synthetic demonstration before the
public-source rename. Re-run the commands below for the current checkout.

## Historical results

- `npm run check` passed: generated schemas, TypeScript build, 79 test files,
  1,457 passing tests, 6 explicitly skipped historical release-candidate checks,
  formatting and committed-JSON checks. The frozen private tarball inventory
  suite is separate and was not run. No other OS or CPU target was exercised.
- New tests cover complete terminal/channel/core inventories, unknown channels,
  duplicate addresses, complete terminal ordering, semantic review, CSV formula
  protection, deterministic compact layout, both flows, all four paper sizes
  in both orientations, embedded PDF fonts and internal links, unsupported glyph
  rejection, viewer search/navigation, guarded output paths, and watch recovery.
- The two-cabinet source validates with no diagnostics: 20 devices, 54 wires,
  3 jumpers, 32 I/O channels, 16 strip terminals, and a four-core cable with two
  explicitly loose spares. Its wire/core schedule includes all 61 conductors.
- Compact mode reduced the original motor-starter packet from 7 to 6 pages.
  The new demo reduced from 24 to 20 pages with the same request and paper.
  The motor power circuits fit one sheet each. Remaining continuations stay
  paired; no minimum text-size reduction was used.
- A local four-run measurement put compact demo layout/rendering around
  0.3-0.4 seconds after compilation. The extra candidates cost more than standard
  mode; these small-example measurements are not a large-project benchmark.
- All 26 delivered PDF pages were visually checked after composition changes.
  Poppler rasterization and pypdf confirmed physical Tabloid landscape dimensions
  (1224 x 792 points), footer numbering and complete content. The demo has 20
  internal PDF sheet links; the motor starter has 14. Every destination resolves.
- The guarded LS1 change uses separate result/report streams, preserves compiler
  diagnostics, confirms a no-write dry run, then applies/validates/renders and
  compares the updated I/O assignment. The original example remains unchanged.

## Historical source archive acceptance

The implementation source archive was checksum-verified, extracted into a new
folder, installed with `npm ci`, built, and used to run both `demo:machine` and
`demo:change`. The generated demo PDF matched the working checkout byte for byte.
The entire checkout was then moved into a path containing a space; regeneration
again produced the same PDF bytes. Visible libraries and fonts were present in
the archive, and no global Thermite installation was used. The detailed local
acceptance record is stored beside the source ZIP in `alpha-out`.

## Current verification commands

```sh
npm install
npm run build
npm test
node packages/cli/dist/bin.js lock examples/machine-demo
node packages/cli/dist/bin.js validate examples/machine-demo --strict
```

## Limits of this verification

The HTML viewer's interactions were checked in a DOM test environment. Browser
preview access was unavailable under this session's browser policy; Safari and
physical printer behavior were not tested. PDF generation and inspection used
the independent vector PDF pipeline.

The three Siemens pilot definitions were checked against official terminal
figures/tables, not tested on hardware or certified by the manufacturer. PLC
programming/address-range validation, ET 200SP BaseUnits/interfaces/network,
complete procurement selection and actual machine engineering remain outside this
demonstration. A successful compile documents checked model rules; it does not
establish a complete or safe installation design.

Manual layout hints, pinned sheet identities and broad manufacturer catalogs
remain future work. Public publication and license selection were not performed.
