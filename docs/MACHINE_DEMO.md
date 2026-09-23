# Machine demonstration and first-project pilot

Thermite 0.3.0-alpha.2 generates a repeatable drawing packet, derived schedules,
and a readable review of electrical changes from the same JSON project. This
example is a synthetic two-cabinet machine documentation demonstration. Its
equipment and wiring are illustrative and require engineering review before use.

## Start the demonstration

From the source checkout on an Apple Silicon Mac with Bun 1.4.2:

```sh
bun install --frozen-lockfile
bun run build
bun run demo:machine
```

The command validates `examples/machine-demo`, then writes:

- `alpha-out/machine-demo.html`: searchable vector-sheet viewer.
- `alpha-out/machine-demo.pdf`: Tabloid landscape packet for printing.
- `alpha-out/machine-io.csv`, `machine-bom.csv`, `machine-wires.csv`,
  `machine-cables.csv`, `machine-terminals.csv`: derived schedules.

Open the HTML in Safari, or open the PDF in Preview. HTML defaults to fit-to-window;
Actual size provides a full-size scrollable view. Search a device designation,
choose a sheet, or follow a conductor continuation link. Printing includes all
sheets even when search is filtering the screen. For printing, use Tabloid at
100% with the PDF's page dimensions; actual printer margins need a first-copy check.

## A short team walkthrough

1. Start with M1 power. Its long horizontal circuit is folded into two sections
   on one sheet. Matching conductor references connect the sections.
2. Show K1 control and find K1 in the device/function references to connect its
   coil and power poles to the same physical device.
3. Search PLC1, follow LS1 from the control cabinet to the field cabinet, and
   use the matching continuation labels across the two sheets.
4. Open CBL1. Four cores are present: two assigned and two explicitly loose
   spares. The terminal plan includes every strip terminal, even unconnected ones.
5. Show the I/O schedule: all 32 channels, authored addresses and spare status.
   Compare the BOM's three exact Siemens order numbers to the visible library.
6. Run the guarded change below, compare the review and regenerated I/O schedule,
   and show how one model produces consistent documentation.

The drawing index is appended after the content, followed by device/function
references. It identifies the content sheets in this packet, not every possible
view of the project. All modeled wires and cable cores remain in the schedules.

## Demonstrate a reviewed change

```sh
bun run demo:change
```

This copies the demo to a new `alpha-out/machine-revision-b` directory, snapshots
its baseline, resolves and inspects PLC1 and the LS1 return wire, queries physical
connectivity, and dry-runs a hash-guarded patch. It checks that dry-run left the
source unchanged, then applies the same patch, validates, and creates a view.

The change moves the LS1 return from PLC1.X10.7 (I0.0) to PLC1.X10.8 (I0.1).
It also updates the signal assignment and spare status. Inspect these outputs:

- `out/review.json`: semantic changes and directly affected devices.
- `out/revision-b.html`: regenerated packet.
- `out/io.csv`: updated I/O assignment schedule.
- `out/agent-evidence.json`: requests, results, diagnostic reports and CLI streams.

The original demo is unchanged. The script refuses to overwrite an existing
revision directory. For another run, choose a new destination:

```sh
bun scripts/demo-change.mjs alpha-out/machine-revision-b-second-run
```

## Useful commands

```sh
bun thermite.mjs packet --project examples/machine-demo --input examples/machine-demo/packet.request.json --paper letter -o alpha-out/machine-letter.pdf
bun thermite.mjs report terminals --device PLC1 --project examples/machine-demo -o alpha-out/plc1-terminals.pdf
bun thermite.mjs report io --device RIO1 --project examples/machine-demo -o alpha-out/rio1.csv
bun thermite.mjs watch --project examples/machine-demo --input examples/machine-demo/packet.request.json -o alpha-out/machine-demo.html
```

Watch checks declared source, library references and the packet request every
second. It keeps the last good drawing when validation fails. Refresh the HTML
after a successful rebuild. A rendering error remains explicit; a retained old
packet should not be mistaken for a successful build of invalid source.

Use `--layout standard` to compare conventional tiling with compact mode. Compact
mode preserves circuit text at 2.5 mm or larger. It may still need multiple sheets;
manual arrangement hints and permanently pinned page breaks are future work.

## Component evidence and model boundaries

The visible `libraries/siemens-pilot` directory contains:

| Device | Exact order number | Official evidence |
| --- | --- | --- |
| CPU 1212C DC/DC/DC | 6ES7212-1AE40-0XB0 | [S7-1200 V20 wiring diagrams, Table 6](https://docs.tia.siemens.cloud/r/simatic_s7_1200_manual_collection_enus_20/technical-specifications/cpu-1212c/cpu-1212c-wiring-diagrams) |
| ET 200SP DI 8x24VDC ST | 6ES7131-6BF01-0BA0 | [02/2019 module manual, p.13, Fig.3-1](https://cache.industry.siemens.com/dl/files/552/59753552/att_82860/v1/et200sp_di_8x24vdc_st_manual_en-US_en-US.pdf) |
| ET 200SP DQ 8x24VDC/0.5A ST | 6ES7132-6BF01-0BA0 | [02/2019 module manual, p.13, Fig.3-1](https://cache.industry.siemens.com/dl/files/588/59753588/att_90143/v1/et200sp_dq_8x24vdc_0_5a_st_manual_en-US_en-US.pdf) |

Each type carries its document revision, terminal evidence and modeling notes.
The demo explicitly wires supply/return terminals and the CPU's unused analog
input shorts. I/O addresses are authored demonstration assignments; Thermite does
not configure or inspect a PLC. Exact duplicate addresses are checked, but
byte/word overlap and PLC program validity are not.

ET 200SP BaseUnits, interface modules, backplane distribution and network
configuration are not modeled. The BOM does not estimate those accessories,
cable lengths or quantities of unmodeled hardware. The remaining generic devices
need actual part selection. The example defines no machine safety architecture.
These are concrete design inputs still needed before using it as an installation
package.

## Move into the actual project

Keep a pinned Thermite source checkout in the project's tools directory. Begin
with `thermite init` or a deliberate copy of the demo; replace the representative
equipment with the project's selected parts and reviewed wiring. Preserve UIDs
for retained physical objects. Keep the local libraries and locks under version
control alongside the electrical JSON and presentation.

For the first pilot, use one bounded cabinet/circuit with known drawings and
review the generated terminals, conductors and part selection against it. Record
missing device behavior or layout needs as small reproducible source examples.
Expand to the rest of the machine after that comparison. Generated views document
selected intent; a successful compile alone does not prove the design is complete.

The current release was checked on Apple Silicon macOS only. Safari behavior and
physical printing need a local user check. The source is licensed under [Apache-2.0](../LICENSE); publication remains a
separate owner action. See the [public release checklist](PUBLIC_RELEASE.md).
