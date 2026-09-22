# Weidmüller connector pilot

35 exact order numbers selected from a representative industrial materials list have manufacturer research, visible JSON models and individual examples. Scope and any unresolved interfaces are recorded for each model.

| Order number / source                | Scope                                                                                                                                | Example                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| [1207500000](research/1207500000.md) | Heavy-duty connector insert / male / 16 numbered contacts and PE assembly / 16 A / size 6 / screw / HDC HE 16 MS                     | [Source](examples/1207500000/source.json) |
| [1207700000](research/1207700000.md) | HDC HE 16 FS female heavy-duty connector insert, 16 numbered poles plus PE assembly, screw termination, installation size 6          | [Source](examples/1207700000/source.json) |
| [1211100000](research/1211100000.md) | Heavy-duty male screw insert / HDC HE 24 MS / 24 numbered contacts and PE assembly / size 8 / 16 A DIN EN 61984                      | [Source](examples/1211100000/source.json) |
| [1211300000](research/1211300000.md) | HDC HE 24 FS female heavy-duty connector insert, 24 numbered poles plus PE assembly, screw termination, installation size 8          | [Source](examples/1211300000/source.json) |
| [1498700000](research/1498700000.md) | HDC HSB 6 MS male screw-contact insert, 6 power poles plus PE, size 6; 400 V / 35 A IEC capability subject to application conditions | [Source](examples/1498700000/source.json) |
| [1498900000](research/1498900000.md) | Connector insert (female) / HDC HSB 6 FS / 6P+PE / 400 V / 35 A / screw / Size 6                                                     | [Source](examples/1498900000/source.json) |
| [1665260000](research/1665260000.md) | HDC 16B DODQ 4BO — size-6 lower-housing cover                                                                                        | [Source](examples/1665260000/source.json) |
| [1665270000](research/1665270000.md) | HDC 16B DMDQ 2QB — size 6 mechanical hood cover                                                                                      | [Source](examples/1665270000/source.json) |
| [1665630000](research/1665630000.md) | Weidmüller HDC 24B DODQ 4BO — protective cover for the lower part (base) of a size 8 (24B/64D) heavy-duty connector housing          | [Source](examples/1665630000/source.json) |
| [1665640000](research/1665640000.md) | HDC 24B DMDQ 2QB — size-8 hood cover                                                                                                 | [Source](examples/1665640000/source.json) |

Read each research note for document revisions, diagram evidence and unresolved details. Full manufacturer documents are linked, not redistributed. Matching a catalog identity does not verify the installation wiring.

## Connections and examples

Numbered insert contacts have separate cable (`C.*`) and mating (`M.*`) authoring endpoints. Each verified power contact uses an explicit source jumper in its example. The protective-earth assembly is one aggregate `PE` endpoint; individual PE interfaces and housing bonds remain unmodeled, so all insert models retain partial coverage. Required PE is explicit library policy for connection presence, not proof of an external bond. Covers have no electrical terminals.

Conditional voltage, current, temperature, approval and torque values remain in the model notes. A connector capability voltage is not an assigned supply voltage. Read conflicting historical/current data before selecting installed hardware.

The [component example guide](../COMPONENT_EXAMPLES.md) explains the unenergized fixtures, fixed links, warnings, HTML/PDF generation and provenance. All examples use this visible canonical library and preserve its byte lock. The standard test suite checks their accepted identities, connectivity and rendered coverage.

## Component batch 05

This round adds thirteen housings and two covers. The housings have zero documented electrical terminals with partial coverage where bonding-interface inventory is not established. No bond is inferred through the panel, insert or metalwork. Covers are mechanical accessories with no electrical contacts.

| Order / research                     | Scope                                                                                                                     | Example                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| [1205000000](research/1205000000.md) | HDC 10B ABU — size 4 bulkhead housing                                                                                     | [Source](examples/1205000000/source.json) |
| [1208600000](research/1208600000.md) | HDC 16B ABU — size 6 bulkhead housing                                                                                     | [Source](examples/1208600000/source.json) |
| [1212400000](research/1212400000.md) | Bulkhead housing / HDC 24B ABU / size 8 / lower part without cover / no cable entries / IP65 in plugged condition         | [Source](examples/1212400000/source.json) |
| [1665230000](research/1665230000.md) | Weidmüller HDC 10B DODQ 4BO protective cover for RockStar size 4 bases; mechanical accessory with no electrical terminals | [Source](examples/1665230000/source.json) |
| [1665240000](research/1665240000.md) | HDC 10B DMDQ 2QB — size 4 protective cover for hoods                                                                      | [Source](examples/1665240000/source.json) |
| [1786880000](research/1786880000.md) | HDC 64D SBU 2M32G — size 8 base housing, two M32 entries                                                                  | [Source](examples/1786880000/source.json) |
| [1787000000](research/1787000000.md) | HDC 40D TSBU 1M32G — size 6 hood, one M32 side entry                                                                      | [Source](examples/1787000000/source.json) |
| [1787550000](research/1787550000.md) | HDC 10B TSBU 1M25G — size 4 hood, one M25 side entry                                                                      | [Source](examples/1787550000/source.json) |
| [1787750000](research/1787750000.md) | HDC 24B TSBU 1M32G — size 8 hood, one M32 side entry                                                                      | [Source](examples/1787750000/source.json) |
| [1787760000](research/1787760000.md) | HDC 24B TSBU 1M25G — size 8 hood, one M25 side entry                                                                      | [Source](examples/1787760000/source.json) |
| [1788180000](research/1788180000.md) | HDC 16B TSBU 1M25G — size 6 hood, one M25 side entry                                                                      | [Source](examples/1788180000/source.json) |
| [1788240000](research/1788240000.md) | HDC 16B SBU 2M25G — size 6 base housing, two M25 entries                                                                  | [Source](examples/1788240000/source.json) |
| [1899980000](research/1899980000.md) | HDC 16B SBU 1M25G — size 6 base housing, one M25 entry                                                                    | [Source](examples/1899980000/source.json) |
| [1901150000](research/1901150000.md) | HDC 24B SBU 1M25G — size 8 base housing, one M25 entry                                                                    | [Source](examples/1901150000/source.json) |
| [1902990000](research/1902990000.md) | HDC 40D SBU 1M32G — size 6 base housing, one M32 entry                                                                    | [Source](examples/1902990000/source.json) |

Each accepted component has recorded manufacturer evidence, declared connection coverage, explicit fixed paths where supported, and a reproducible HTML/PDF example. Read the [example guide](../COMPONENT_EXAMPLES.md) before using a structural fixture as the basis for project wiring.

## Component batch 06

This round adds 10 exact parts. Electrical diagrams and source notes define the supported scope; partial connection coverage remains a compiler warning.

| Order / research                     | Scope                                                                                                                         | Example                                   |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| [1651310000](research/1651310000.md) | Weidmüller HDC HVE 3+2 MS / 1651310000 / male screw insert / size 4 / three power + two lagging pilot contacts + aggregate PE | [Source](examples/1651310000/source.json) |
| [1651320000](research/1651320000.md) | Weidmüller HDC HVE 3+2 FS female screw contact insert, size 4; numbered 1/3/5/7/9 plus aggregate PE                           | [Source](examples/1651320000/source.json) |
| [1651330000](research/1651330000.md) | HDC HVE 6+2 MS male screw insert, size 6; six numbered power and two pilot contacts plus aggregate PE                         | [Source](examples/1651330000/source.json) |
| [1651340000](research/1651340000.md) | Weidmüller HDC HVE 6+2 FS / 1651340000 / female screw insert / size 6 / six power + two lagging pilot contacts + aggregate PE | [Source](examples/1651340000/source.json) |
| [1651350000](research/1651350000.md) | HDC HVE 10+2 MS male screw insert, size 8; 10 power + 2 pilot + aggregate PE                                                  | [Source](examples/1651350000/source.json) |
| [1651360000](research/1651360000.md) | HDC HVE 10+2 FS / female screw connector insert / size 8 / 10 power + 2 pilot + PE                                            | [Source](examples/1651360000/source.json) |
| [1789960000](research/1789960000.md) | HDC S4 0 SAS male axial-screw insert, size 6; four numbered power contacts plus aggregate PE                                  | [Source](examples/1789960000/source.json) |
| [1789970000](research/1789970000.md) | HDC S4 0 BAS female axial-screw contact insert, size 6, four numbered power contacts plus aggregate PE                        | [Source](examples/1789970000/source.json) |
| [1826790000](research/1826790000.md) | HDC HEE 32 MC male insert body, size 6, 32 crimp-contact cavities; crimp contacts supplied separately                         | [Source](examples/1826790000/source.json) |
| [1826800000](research/1826800000.md) | HDC HEE 32 FC female insert body, size 6, 32 crimp-contact cavities; crimp contacts supplied separately                       | [Source](examples/1826800000/source.json) |
