# ABB component pilot

26 exact order numbers selected from a representative industrial materials list have manufacturer research, visible JSON models and individual examples. Scope and any unresolved interfaces are recorded for each model.

| Order number / source                          | Scope                                                                                                                       | Example                                        |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| [1SCA022042R6530](research/1sca022042r6530.md) | OXP6X360 extended shaft for pistol handle, 360 mm length, 6 mm diameter                                                     | [Source](examples/1sca022042r6530/source.json) |
| [1SCA022112R2010](research/1sca022112r2010.md) | OFAX 00 S1L single-pole fuse base, size 00, 160 A, Ui 1000 V, 20 mm terminals, IP20; fuse and terminal accessories excluded | [Source](examples/1sca022112r2010/source.json) |
| [1SCA022190R1560](research/1sca022190r1560.md) | OESAZX167 mechanical shaft-extension coupler, 6 mm shaft size                                                               | [Source](examples/1sca022190r1560/source.json) |
| [1SCA022661R3610](research/1sca022661r3610.md) | OHZX10 black shaft alignment ring                                                                                           | [Source](examples/1sca022661r3610/source.json) |
| [1SCA022731R8150](research/1sca022731r8150.md) | OTS250G1L/3 long three-pole grey plastic terminal-shroud kit                                                                | [Source](examples/1sca022731r8150/source.json) |
| [1SNA356204R1100](research/1sna356204r1100.md) | BRU125AL / historical BRU125A single-pole eight-connection distribution block                                               | [Source](examples/1sna356204r1100/source.json) |
| [2CDS200936R0001](research/2cds200936r0001.md) | S2C-H11L left-mounted auxiliary switch, 1 NO + 1 NC                                                                         | [Source](examples/2cds200936r0001/source.json) |
| [2CDS271001R0044](research/2cds271001r0044.md) | S201M-C4 miniature circuit breaker, one pole, C characteristic, 4 A                                                         | [Source](examples/2cds271001r0044/source.json) |
| [2CDS271001R0065](research/2cds271001r0065.md) | S201M-B6 miniature circuit breaker, one pole, B characteristic, 6 A                                                         | [Source](examples/2cds271001r0065/source.json) |
| [2CDS271001R0104](research/2cds271001r0104.md) | S201M-C10 miniature circuit breaker / 1 pole / C characteristic / 10 A / Icn 10 kA                                          | [Source](examples/2cds271001r0104/source.json) |
| [2CDS271001R0204](research/2cds271001r0204.md) | S201M-C20 miniature circuit breaker, one pole, C characteristic, 20 A                                                       | [Source](examples/2cds271001r0204/source.json) |
| [2CDS271001R0254](research/2cds271001r0254.md) | S201M-C25 miniature circuit breaker / 1 pole / C characteristic / 25 A                                                      | [Source](examples/2cds271001r0254/source.json) |
| [2CDS272001R0024](research/2cds272001r0024.md) | S202M-C2 miniature circuit breaker, two poles, C characteristic, 2 A                                                        | [Source](examples/2cds272001r0024/source.json) |
| [2CDS272001R0044](research/2cds272001r0044.md) | S202M-C4 miniature circuit breaker; two poles; C characteristic; 4 A; Icn 10 kA at 400 V AC (IEC/EN 60898-1)                | [Source](examples/2cds272001r0044/source.json) |
| [2CDS272001R0064](research/2cds272001r0064.md) | S202M-C6 miniature circuit breaker, two poles, C characteristic, 6 A                                                        | [Source](examples/2cds272001r0064/source.json) |
| [2CDS272001R0164](research/2cds272001r0164.md) | ABB S202M-C16 miniature circuit breaker / 2 poles / C characteristic / 16 A / Icn 10 kA at 400 V AC                         | [Source](examples/2cds272001r0164/source.json) |
| [2CDS272001R0204](research/2cds272001r0204.md) | S202M-C20 miniature circuit breaker / two poles / C curve / 20 A                                                            | [Source](examples/2cds272001r0204/source.json) |
| [2CSR272140R1164](research/2csr272140r1164.md) | DS202C M C16 A30 RCBO / 2 protected poles / C16 / type A / 30 mA / Icn 10 kA                                                | [Source](examples/2csr272140r1164/source.json) |

Read each research note for document revisions, diagram evidence and unresolved details. Full manufacturer documents are linked, not redistributed. Matching a catalog identity does not verify the installation wiring.

## Connections and examples

Breaker and auxiliary-contact functions do not create permanent physical connections. Mechanically ganged poles remain separate nets. The empty fuse base joins only its documented tab/fuse-contact/measuring-tap assemblies on each side; it does not bridge the missing fuse. The distribution block has one documented common pole. Mechanical accessories have no electrical terminals.

Conditional voltage, current, temperature, approval and torque values remain in the model notes. A connector capability voltage is not an assigned supply voltage. Read conflicting historical/current data before selecting installed hardware.

The [component example guide](../COMPONENT_EXAMPLES.md) explains the unenergized fixtures, fixed links, warnings, HTML/PDF generation and provenance. All examples use this visible canonical library and preserve its byte lock. The standard test suite checks their accepted identities, connectivity and rendered coverage.

## Component batch 06

This round adds 8 exact parts. Electrical diagrams and source notes define the supported scope; partial connection coverage remains a compiler warning.

| Order / research                               | Scope                                                                                                                                      | Example                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| [1SAJ240100R0003](research/1saj240100r0003.md) | PDP22-FBP.025 PROFIBUS DP-V1 FieldBusPlug, integral 0.25 m cable                                                                           | [Source](examples/1saj240100r0003/source.json) |
| [1SCA022042R6110](research/1sca022042r6110.md) | OXP12X535 mechanical operating shaft for pistol handles, 535 mm length, 12 mm diameter                                                     | [Source](examples/1sca022042r6110/source.json) |
| [1SCA022112R2440](research/1sca022112r2440.md) | OFAX 00 S2L two-pole fuse base, size 00, 160 A, Ui 1000 V, 20 mm tabs; fuses and terminal accessories excluded                             | [Source](examples/1sca022112r2440/source.json) |
| [1SCA022456R9710](research/1sca022456r9710.md) | OS32D12 three-pole DIN 000/00 switch fuse; 12 schematic endpoint aliases, removable fuse links unmodeled                                   | [Source](examples/1sca022456r9710/source.json) |
| [1SCA022701R0700](research/1sca022701r0700.md) | HRC fuse link, DIN-type NH size 2, gG, 250 A, 690 V AC / 250 V DC (ABB OFAA2GG250)                                                         | [Source](examples/1sca022701r0700/source.json) |
| [1SCA022710R0100](research/1sca022710r0100.md) | ABB OT250E03P switch-disconnector / 3-pole / front operated, pistol handle / 250 A / IEC 60947-3                                           | [Source](examples/1sca022710r0100/source.json) |
| [1SVR430720R0400](research/1svr430720r0400.md) | CM-MSS (4) thermistor motor protection relay, 24-240 V AC/DC, one PTC circuit, 1 NO + 1 NC                                                 | [Source](examples/1svr430720r0400/source.json) |
| [1SVR430831R1400](research/1svr430831r1400.md) | ABB CM-ESS.2 single-phase RMS voltage monitoring relay / 220-240 V AC supply / measuring input B-C (ranges 3-600 V) / 2 c/o (SPDT) outputs | [Source](examples/1svr430831r1400/source.json) |
