# zb4-bvb3 — Schneider ZB4-BVB3 / ZB4BVB3

Decision: **candidate with partial physical coverage**. The exact historical component is a green protected integral LED body with a Zamak fixing collar, **24 V AC/DC**, and two lamp supply screws **X1 and X2**. No contact block, third test terminal, external head or protective-earth screw is added to this order.

## Exact identity and historical ratings

**S1 — [Manufacturer ZB4BVB3 datasheet, 6 April 2020](https://iportal.se.com/Contents/docs/SQD-ZB4BVB3_DATASHEET.PDF), four pages.** Pages 1–2 were independently viewed. The exact reference names the complete body/light block, green protected integral LED, Zamak collar, screw clamps and `(X1-X2)PL`. Rated supply is 24 V AC/DC, 50/60 Hz for AC; operating limits are 19.2–30 V DC and 21.6–26.4 V AC. Consumption is 18 mA. The sheet states Class I shock protection, 0.8–1.2 N·m terminal torque and conditional conductor/temperature/insulation figures. Its 600 V insulation and 6 kV impulse withstand are not lamp supply ratings. Page 3's dimensional outline was retained from the author, without treating it as a connection diagram.

**S2 — [Historical Schneider/Telemecanique Harmony style 4 catalogue](https://www.farnell.com/datasheets/1644676.pdf), physical/printed page 28, independently viewed.** Its exact **ZB4-BVB3** row specifies green, 24 V AC/DC, screw-clamp complete body comprising fixing collar plus integral LED, 0.054 kg. The matching alphanumeric identity, scope, color, voltage and mass support the presentation-hyphen equivalence with S1. The original source order spelling is retained. The catalogue's edition is not established; it is not assigned an invented date. Footnote 1 identifies the three-terminal test version by the separate suffix `156`, including the example `ZB4-BVB3156`.

**S3 — [Manufacturer Harmony XB4 catalogue, October 2021, V13.0, DIA5ED2121212EN](https://iportal.se.com/Contents/docs/HARMONY%20XB4%20METAL%20CONTROL%20AND%20SIGNALING%20UNITS_CATALOG.PDF).** Physical page 88 / printed 86 confirms the exact green 24 V AC/DC collar-plus-LED body row. Physical 68 / printed 66 gives `XB4BVB3 = ZB4BVB3 + ZB4BV033`, so the external head/lens is separate. Physical 79 / printed 77 lists the green 24 V light module ZBVB3. These rows were visually inspected. The shared grounding-accessory row on physical 83 / printed 81 separately lists ZBZ110.

## Recovered applicable terminal views

**S4 — [Direct manufacturer exact-product ZB4BVB3 PDF](https://www.se.com/au/en/product/download-pdf/ZB4BVB3), generated 12 September 2026, ten pages.** Retrieved using normal TLS and preserved unchanged. Independently rendered and visually inspected pages 7–9:

- Page 8 shows the side-marked **X1–lamp–X2** circuit on the block.
- Page 9 shows the rear face with **exactly two screw clamps**, marked **X1** and **X2**, and the separate collar fixing screw.
- Page 7 distinguishes the metal collar and fixing mechanism from the attached LED body.

The document header identifies ZB4BVB3, but its alternate-view artwork contains generic `ZBV-XX` and `xx V` / `xx mA` placeholders. It corroborates terminal topology with the exact 2020 text and historical assembly rows; it does **not** establish a physical installed revision, a new rating, polarity, or replacement equivalence. Historical green-LED evidence remains authoritative for the modeled identity; no later universal-white BVB1 replacement is substituted.

The previously recovered [Schneider FAQ FA272320](https://www.se.com/fr/fr/faqs/FA272320/) and its original circuit image were also inspected and preserved as supplementary evidence. Its left-hand optional test arrangement explicitly covers the ZBV-B family and depicts X1/X2, but its prose does not identify the exact green B3 body. That bridge is no longer necessary after S4. Its left DC example shows X1 toward negative and X2 toward switched positive; this is a test-circuit example, not proof of general reverse-polarity tolerance or a mandatory base-body polarity. The right-hand G/M capacitor explanation is not transferred to B3. No T terminal, test diode or test wiring is imported.

## Model and polarity limits

The candidate has two required power terminals, X1 and X2, one `load` function using the existing `lamp` symbol, and **no fixed links**. Required supply endpoints are explicit library policy for the modeled operating lamp. Load membership does not make the lamp a permanent short.

The scalar nominal voltage is 24 V. `voltage_type` is omitted because the schema only accepts a single AC or DC value, while this product supports both; AC/DC and 50/60 Hz remain explicit in descriptions and notes. Consumption is documentary, not a contact current capability.

X1/X2 are manufacturer names, without invented +/− or L/N aliases. The exact-order sources do not establish a mandatory DC polarity assignment or reverse-polarity tolerance. The model therefore does not claim arbitrary DC orientation. Project wiring must establish its applicable arrangement; AC/DC compatibility alone does not settle polarity.

## Partial protective-bonding scope

**S5 — [Schneider ZBZ110 instruction NHA93116 01, 06-2021](https://download.se.com/files?p_Doc_Ref=NHA93116&p_File_Name=NHA93116_01.pdf&p_enDocType=Instruction+sheet), one page, visually inspected.** It shows a separate grounding plate between support and collar. For non-conducting or painted support, its ground terminal connects to the grounding circuit.

Class I protection and metal presence do not prove an upstream bond. The collar fixing screw is not reclassified as a PE screw, and neither lamp terminal is joined to the metalwork. Protective bonding must be established by the project. Coverage is **partial** for the installation-dependent collar/support/earthing interface and its continuity; both documented lamp screws are represented.

## Original comparison and handoff

The original worker ended `needs-evidence` without a type because it lacked an applicable terminal diagram and bonding-interface evidence. The independent review recovered S4 and S5, supporting this scoped candidate. Its original files remain untouched; hashes are in `../../reviewer-0397/original-hashes.json`. Job and schema are byte-identical copies. Evidence URLs, editions, hashes and review scope are in `sources.json`; page images and render metadata are under `references/`.

The coordinator owns verification and promotion.
