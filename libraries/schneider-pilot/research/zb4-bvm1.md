# zb4-bvm1 — Schneider ZB4-BVM1 / ZB4BVM1

Decision: **candidate for the exact catalog order**, with partial physical coverage and an unresolved source-description conflict. Schneider's historical ZB4BVM1 is the white integral-LED light block with metal fixing collar, **230–240 VAC, 50/60 Hz**. It is not a verified 24 VAC/DC device. The source order `ZB4-BVM1` is retained verbatim; the matching alphanumeric manufacturer spelling omits the presentation hyphen. The source's 24 VAC/DC description remains prominently recorded, with no substitution of BVB1 or assumption about the installed unit.

## Traceable evidence

- **S1:** [Exact Schneider ZB4BVM1 sheet, 5 October 2019, manufacturer-authored mirror](https://media.distributordatasolutions.com/schneider2/2019q4/912d9bb11a40a5d2ae33882b3d897c0c498d09c9.pdf). Physical page 1 visually reviewed: white protected integral LED, complete body/light assembly with Zamak collar, screw clamps, 230–240 VAC at 50/60 Hz and `(X1-X2)PL`. It also states 195–264 VAC supply limits, 14 mA consumption and Class I protection. Page 3's body/collar dimensions drawing was inspected without treating it as a wiring schematic.
- **S2:** [Primary Harmony XB4 catalogue, July 2019, V10.1, DIA5ED2121212EN](https://iportal.se.com/Contents/docs/CONTROL%20AND%20SIGNALING%20UNITS%20HARMONY%20XB4%20METAL.PDF). Exact row on physical page 85 / printed 84, visually reviewed: ZB4BVM1, white, 230–240 VAC 50/60 Hz, complete fixing collar plus integral-LED block with screw terminals. This establishes the historic voltage independently of current universal-LED descriptions.
- **S3:** [Primary Harmony XB4 catalogue, October 2021, V13.0, DIA5ED2121212EN](https://iportal.se.com/Contents/docs/HARMONY%20XB4%20METAL%20CONTROL%20AND%20SIGNALING%20UNITS_CATALOG.PDF). Exact body row on physical 88 / printed 86; complete-unit composition on physical 68 / printed 66; separate grounding accessory on physical 83 / printed 81. All were visually reviewed. `XB4BVM1 = ZB4BVM1 + ZB4BV013` shows that the external head/lens is separate from this body order.
- **S4:** [Schneider FAQ FA272320, lamp-test circuits](https://www.se.com/fr/fr/faqs/FA272320/), published 8 October 2015. It expressly identifies ZB4BVM1 as a 230 VAC Protected LED example. The original manufacturer circuit image was visually inspected: its **right-hand ZBZ-M156 arrangement for ZBV-M light blocks** shows each lamp's two screws **X1 and X2** on AC supply conductors. The neighboring T/diode blocks, test contacts and interconnecting wires belong to an optional test arrangement, not the base lamp body. The left AC/DC circuit is not transferred to this AC order. The FAQ describes a coupling capacitor and diodes; neither makes the lamp a short circuit.
- **S5:** [Schneider NHA93116_01, ZBZ110 grounding-plate instructions](https://download.se.com/files?p_Doc_Ref=NHA93116&p_File_Name=NHA93116_01.pdf&p_enDocType=Instruction+sheet), 06-2021, one page, visually reviewed. A separate grounding plate fits between support and collar. The instructions require a grounding-circuit connection when the assembly is mounted on a non-conducting or painted support. This does not establish that ZBZ110 is included in ZB4BVM1 or fitted to the source installation.
- **S6:** [Schneider 155997103A55_08 mounting instruction](https://download.se.com/files?p_Doc_Ref=155997103A55&p_File_Name=155997103A55_08.pdf&p_enDocType=Instruction+sheet), printed A08, 01-2011, one page. Its applicable XB4B/ZB4B illustration distinguishes mechanical collar mounting from electrical block attachment. Example contact-block drawings do not add contacts to this light body.

Source PDFs, the original FAQ circuit image, reviewed page renders, crop/render metadata and extracted text are preserved under `references/`. `sources.json` includes acquisition URLs, actual editions and SHA-256 hashes. Source authority and scope are explicit; manufacturer-authored mirrors are not represented as manufacturer-hosted downloads.

## Modeled inventory

| Connection or item                             | Treatment                                                                     |
| ---------------------------------------------- | ----------------------------------------------------------------------------- |
| X1                                             | One required lamp supply screw                                                |
| X2                                             | Other required lamp supply screw, electrically distinct from X1               |
| White integral LED block                       | One load function using the existing lamp symbol                              |
| Metal fixing collar and its mounting screw     | Included mechanical assembly, documented without an invented lamp/PE terminal |
| Head/lens, contact blocks and test accessories | Not included in this exact body model                                         |
| Separate grounding plate and installed bond    | Installation-dependent; neither included nor proven by this model             |

X1/X2 are the actual manufacturer terminal names. No L/N or +/− aliases are invented. The exact order and applicable right-hand diagram establish AC supply; no DC operation or DC polarity assignment is claimed. “Universal LED” in later listings must not be read as universal AC/DC voltage compatibility.

Both X1 and X2 are required under the job's explicit library policy for the modeled operating lamp. One `load` function with `lamp` symbol is used. There are no contact functions, test-T terminal, communication ports or fixed links. The lamp input electronics never join X1 and X2 into a permanent physical net.

## Partial bonding scope

The Class I classification and metal collar do not prove an upstream protective bond. No independent PE field screw is documented on the base LED body. The collar fixing screw is not reclassified as a PE screw, and neither lamp terminal is joined to the collar.

Protective bonding must be established by the project using the applicable support/earthing arrangement. Schneider documents the separate ZBZ110 grounding plate and the non-conducting/painted-support condition, but the source unit and its mounting were not inspected. `connectionCoverage.status` is `partial` because the collar/support/earthing interface and its electrical continuity are not modeled, despite the established two-terminal lamp circuit.

## Ratings and source conflict

The rated supply is a **230–240 VAC range at 50/60 Hz**; **195–264 VAC** is the separate operating limit. Only `voltage_type: AC` is scalar terminal metadata. A single nominal voltage or frequency is not invented to compress the range. The documented 600 V insulation rating and 6 kV impulse withstand are capabilities, not operating supplies. The 14 mA value is lamp consumption, not a switching-contact rating. Conductor, torque, temperature and life conditions remain documentary.

The source's **24 VAC/DC** description conflicts with the exact historic order evidence. This followup models the named catalog item while preserving that conflict; procurement/nameplate and actual circuit evidence are still needed to establish the installed identity and suitability. It does not determine which source field is wrong, approve an electrical change or substitute a 24 V body.

## Independent review outcome

The original author ended `needs-evidence` without a type because it lacked a terminal diagram and bonding-interface source. The independent review recovered the applicable manufacturer lamp circuit and separate grounding-plate instruction. These support a two-terminal exact-order candidate with explicit partial bonding scope; the installed identity conflict remains unresolved.

Original author files are unchanged. Their hashes and the absence of an original `type.json` are recorded in `../../reviewer-0399/original-hashes.json`. `job.json` and `candidate.schema.json` were copied byte-for-byte.
