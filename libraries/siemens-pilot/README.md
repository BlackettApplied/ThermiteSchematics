# Siemens pilot library

23 exact order numbers are modeled from manufacturer documents. This is a
small reviewed-by-source pilot, not Siemens certification or a family-wide
catalog. See each type's `catalog.document` and `catalog.modelingNotes` for the
terminal evidence and exclusions. Manufacturer PDFs are linked, not redistributed.

- CPU 1212C DC/DC/DC, 6ES7212-1AE40-0XB0: physical connector pin tables, 8 DI,
  6 DQ, 2 AI, separate supply/common/functional-earth terminals.
- ET 200SP DI 8x24VDC ST, 6ES7131-6BF01-0BA0: terminals 1-8 map to DI0-DI7;
  terminals 9-16 are sensor supplies on the documented BaseUnit arrangement.
- ET 200SP DQ 8x24VDC/0.5A ST, 6ES7132-6BF01-0BA0: terminals 1-8 map to
  DQ0-DQ7; terminals 9-16 are returns on the documented BaseUnit arrangement.

The ET 200SP terminal figures were visually checked against pages 13 of the
02/2019 manuals. CPU terminals were checked against the V20 table 6 on
September 6, 2026. The base units, backplane distribution, interface modules and
network are outside this first library model. Their required selection must be
completed for an actual installation. No implicit internal net joins are made.

Use an explicit relative path in the project's `system.json`, then run
`thermite lock <project>`. All library JSON remains visible. For new types, the
explicit `thermite:io-module`, `thermite:terminal-strip` and `thermite:dc-supply`
symbol profiles support the documented function shapes; other shapes are
explicitly unsupported. Unknown type names never imply electrical behavior.

## Additional catalog candidates

Three additional exact Siemens items are independently sourced catalog
candidates. Their availability does not identify hardware in any installation.

| Type/order number                         | Inventory                                                                           | Primary evidence                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6ES7215-1BG40-0XB0, CPU 1215C AC/DC/relay | 38 assigned field terminals, 14 DI, 10 relay DQ, 2 AI, 2 AQ, 2 Ethernet sockets     | [S7-1200 V4.5 manual](https://cache.industry.siemens.com/dl/files/241/109797241/att_1066673/v1/s71200_system_manual_en-US_en-US.pdf), A5E02486680-AO, 05/2021, pp.1237-1238                                                                                                                                            |
| 6ES7231-5QD32-0XB0, SM1231 TC4            | 14 field connector positions: 11 assigned, 3 unassigned; 4 differential TC channels | Same manual, pp.1288-1289                                                                                                                                                                                                                                                                                              |
| 6AV2124-0JC01-0AX0, TP900 Comfort         | Power/functional earth, 2 Ethernet sockets, serial, USB and audio pin inventory     | [Comfort Panels manual](https://cache.industry.siemens.com/dl/files/233/49313233/att_904646/v1/HWComfortPanelsenUS_en-US.pdf), A5E36770603-AE, 07/2022, pp.21, 220, 229-231; [exact order-number data](https://support.industry.siemens.com/teddatasheet/?caller=SIOS&format=pdf&language=en&mlfbs=6AV2124-0JC01-0AX0) |

The CPU's AC supply inputs, TC module's 24 V supply pair and HMI's X80 power pair
are marked required. Optional channels, their commons and interfaces need
application-specific connection review. Functional earth stays separate from
power return. No function creates an implicit electrical short or an energized
circuit. All three types remain `partial`, with explicit exclusions for
backplane, optional internal interfaces, shells/shields or mode-dependent
behavior. Unassigned connector positions are inventory annotations; a
prohibition on wiring those positions is not yet compiler-enforced.

The original continuous `thermite:io-module` profile supports the CPU's
single-terminal channels and the HMI's DC supply. It does not currently support
the CPU AC supply or differential TC channel shapes. Use terminal wiring views
for these connections; unsupported continuous views retain their diagnostics.
The [candidate wiring example](examples/candidate-wiring/README.md) validates
all three items and generates two sheets showing explicit power and TC pins.
It also provides a reproducible terminal inventory and physical-net check.

The existing `types/*.json` manifest includes all 23 exact types. Manufacturer
manuals were reviewed on September 8, 2026 and are linked rather than copied
into the repository. Existing pilot types were not changed by this addition.

## Industrial component batch

| Order number / source                      | Scope                                                        | Example                                      |
| ------------------------------------------ | ------------------------------------------------------------ | -------------------------------------------- |
| [3SB3420-0C](research/3sb3420-0c.md)       | Base-mounted screw-terminal contact block, 1 NC              | [Source](examples/3sb3420-0c/source.json)    |
| [6EP1332-1SH43](research/6ep1332-1sh43.md) | LOGO!Power isolated stabilized power supply, 24 V DC / 2.5 A | [Source](examples/6ep1332-1sh43/source.json) |

The contact block preserves its verified NC suffixes and marks the incomplete physical legend explicitly. The LOGO! supply distinguishes L/N input, duplicated positive/negative output screws and isolated conversion; it has no invented PE terminal. Read the source notes for conditional supply ratings and thermal derating. The [component example guide](../COMPONENT_EXAMPLES.md) covers both fixtures.

## Component batch 05

This round adds three NH fuses and twelve ET 200S electronic, interface and terminal-base models. I/O examples use documented base arrangements; a selected assembly abstraction is not evidence of the installed per-slot pairing. Do not duplicate its field clamps with a separately modeled full base. The bare TM-P base does not inherit the fitted PM-E module’s power paths. Both IM151 Ethernet ports support logical network views; physical socket pin maps use separate documented aliases.

| Order / research                                     | Scope                                                                                                                       | Example                                           |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| [3NA3122](research/3na3122.md)                       | NH1 fuse link, 63 A, gG, front indicator, live grip lugs                                                                    | [Source](examples/3na3122/source.json)            |
| [3NA3810](research/3na3810.md)                       | NH000 fuse link, 25 A, gG, front indicator, live grip lugs                                                                  | [Source](examples/3na3810/source.json)            |
| [3NA3836](research/3na3836.md)                       | NH00 gG fuse link / 160 A / front indicator / live grip lugs                                                                | [Source](examples/3na3836/source.json)            |
| [6ES7131-4BF00-0AA0](research/6es7131-4bf00-0aa0.md) | ET 200S 8DI DC24V electronic module; partial assembled field interface with compatible TM-E15x24-01 base                    | [Source](examples/6es7131-4bf00-0aa0/source.json) |
| [6ES7131-4RD02-0AB0](research/6es7131-4rd02-0ab0.md) | ET 200S 4DI NAMUR electronic module; partial assembled eight-clamp field interface                                          | [Source](examples/6es7131-4rd02-0ab0/source.json) |
| [6ES7132-4BB31-0AA0](research/6es7132-4bb31-0aa0.md) | ET 200S 2DO DC24V/2A ST; documented assembled field interface on TM-E15C26-A1                                               | [Source](examples/6es7132-4bb31-0aa0/source.json) |
| [6ES7132-4BD32-0AA0](research/6es7132-4bd32-0aa0.md) | ET 200S 4DO DC24V/2A ST; assembled 26-A1 field-interface abstraction                                                        | [Source](examples/6es7132-4bd32-0aa0/source.json) |
| [6ES7132-4BF00-0AA0](research/6es7132-4bf00-0aa0.md) | ET 200S 8DO 24 V DC/0.5 A, 15 mm; assembled interface with separate TM-E15S26-A1 base                                       | [Source](examples/6es7132-4bf00-0aa0/source.json) |
| [6ES7134-4GB11-0AB0](research/6es7134-4gb11-0ab0.md) | ET 200S 2AI I 4WIRE ST; assembled field interface on TM-E15C24-01                                                           | [Source](examples/6es7134-4gb11-0ab0/source.json) |
| [6ES7135-4FB01-0AB0](research/6es7135-4fb01-0ab0.md) | ET 200S 2AO U ST; assembled field-interface abstraction with TM-E15C24-01; partial backplane coverage                       | [Source](examples/6es7135-4fb01-0ab0/source.json) |
| [6ES7135-4GB01-0AB0](research/6es7135-4gb01-0ab0.md) | ET 200S 2AO I ST analog current output module; eight-clamp TM-E15C24-01 assembled field interface                           | [Source](examples/6es7135-4gb01-0ab0/source.json) |
| [6ES7138-4CA01-0AA0](research/6es7138-4ca01-0aa0.md) | ET 200S PM-E DC24V with diagnostics; assembled field interface on separately ordered TM-P15C23-A0 (6ES7193-4CD30-0AA0)      | [Source](examples/6es7138-4ca01-0aa0/source.json) |
| [6ES7151-3AA23-0AB0](research/6es7151-3aa23-0ab0.md) | ET 200S IM 151-3 PN ST interface module                                                                                     | [Source](examples/6es7151-3aa23-0ab0/source.json) |
| [6ES7193-4CB30-0AA0](research/6es7193-4cb30-0aa0.md) | ET 200S TM-E15C24-01 spring-terminal base; partial functional interface model                                               | [Source](examples/6es7193-4cb30-0aa0/source.json) |
| [6ES7193-4CD30-0AA0](research/6es7193-4cd30-0aa0.md) | TM-P15C23-A0 ET 200S bare terminal base; six field clamps and outgoing AUX1 interface, with partial mating-contact coverage | [Source](examples/6es7193-4cd30-0aa0/source.json) |

Each accepted component has recorded manufacturer evidence, declared connection coverage, explicit fixed paths where supported, and a reproducible HTML/PDF example. Read the [example guide](../COMPONENT_EXAMPLES.md) before using a structural fixture as the basis for project wiring.
