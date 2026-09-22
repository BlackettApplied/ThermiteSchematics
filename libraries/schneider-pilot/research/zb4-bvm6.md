# zb4-bvm6 — Schneider ZB4-BVM6 / ZB4BVM6

**Decision: corrected candidate, partial coverage.** Exact manufacturer evidence now supports X1/X2 and the blue order's own electrical characteristics.

## Exact identity, range and included parts

The [exact Schneider ZB4BVM6 datasheet](https://www.se.com/au/en/product/download-pdf/ZB4BVM6), printed **12 September 2026**, is 10 physical pages. Independently inspected **pages 1–2** identify a **blue protected integral-LED complete body/light block**, Zamak fixing collar, screw-clamp terminals and **(X1-X2)PL**. Rated supply is **230–240 V AC at 50/60 Hz**; operating limits are **195–264 V AC**. The exact order's consumption is **14 mA**; lifetime is 100000 h at rated voltage and 25 °C. Page 2 says **Class I**. This exact sheet eliminates the original proposal's reliance on another color's datasheet.

This is not solely a current replacement listing: the [July 2019 Harmony XB4 catalog](https://iportal.se.com/Contents/docs/CONTROL%20AND%20SIGNALING%20UNITS%20HARMONY%20XB4%20METAL.PDF), **physical 85 / printed 84**, explicitly lists **ZB4BVM6**, blue, 230–240 V AC 50/60 Hz under complete fixing-collar plus light-block assemblies. The [October 2021 catalog](https://iportal.se.com/Contents/docs/HARMONY%20XB4%20METAL%20CONTROL%20AND%20SIGNALING%20UNITS_CATALOG.PDF), **physical 88 / printed 86**, independently repeats the exact body row. Both exact rows were visually inspected; no adjacent 24 V or different-color order is substituted.

The source spelling **ZB4-BVM6** is preserved. The manufacturer sources use **ZB4BVM6**, with identical alphanumeric order and exact blue body/light/collar composition. This documented punctuation normalization does not establish the original installed unit or silently replace the M voltage suffix.

The 2021 catalog **physical 68 / printed 66** explicitly decomposes the complete blue pilot light as **XB4BVM6 = ZB4BVM6 + ZB4BV063**. Thus the external head/lens is separate from the modeled body. The original proposal incorrectly cited physical page 69 for that decomposition; page 69 contains the separate heads table. No contact block, external head, test unit or grounding accessory is added here.

## Diagram and all documented electrical endpoints

[Schneider FAQ FA272320](https://www.se.com/fr/fr/faqs/FA272320/) includes an original circuit image whose **right-hand ZBZ-M156 diagram expressly applies to ZBV-M light blocks**. The 2021 catalog **physical 79 / printed 77** identifies exact **ZBVM6** as the blue 230–240 V AC protected-LED light block. Together with exact ZB4BVM6 body evidence, this establishes applicability of the M-series circuit; it is not a transfer of another color's ratings.

I visually inspected the FAQ image and read the preserved official HTML already recovered in reviewer-0399. Each lamp has exactly two screw endpoints **X1/X2**, connected between AC conductors. The **T** terminals, test diodes, switches and surrounding conductors belong to separately ordered test assemblies. They do not add terminals or fixed links to ZB4BVM6. The adjacent left AC/DC test scheme is not applied to this AC order.

| Endpoint | Modeled scope                                                            |
| -------- | ------------------------------------------------------------------------ |
| X1       | Actual manufacturer lamp supply designation; one screw-clamp point       |
| X2       | Actual manufacturer other lamp supply designation; one screw-clamp point |

Both endpoints are `required: true` under the requested operating-lamp library policy. One `load` function with the supported `lamp` mark spans them. They remain separate compiler nets. No DC polarity or L/N assignment is asserted; AC metadata is retained.

The exact current PDF's pages **8–9** also contain generic manufacturer illustrations of a **ZBV-XX** body and its X1/X2 marks. These illustrations were visually inspected but contain placeholder ratings and a generic LED appearance. They are **not claimed to be exact blue-unit photographs**. The exact textual terminal field and applicable M-series circuit are the electrical authority. Saved native illustrations are `references/zb4bvm6-current-p8-image142.jpeg` and `references/zb4bvm6-current-p9-image153.jpeg`; the actual FAQ circuit is `references/FA272320-manufacturer-circuit.jpg`.

## Remaining scope and corrections

The candidate does not substitute a BVB voltage variant.

**Collar/earthing remains partial:** Class I and a metal collar do not prove protective bonding. The 2021 catalog **physical 83 / printed 81** separately lists the **ZBZ110 grounding plate**. Its [NHA93116_01 instruction](https://download.se.com/files?p_Doc_Ref=NHA93116&p_File_Name=NHA93116_01.pdf&p_enDocType=Instruction+sheet), **June 2021, page 1/1**, was visually inspected: the plate sits between support and collar and has its own earth provision. The instruction addresses bonding for non-conducting or painted mounting support. It does not establish accessory inclusion or installed continuity for this body order. No integral light-block PE endpoint, fastening-screw-as-PE identity, automatic collar/panel bond or complete physical-interface claim is made.

The followup removes the original **230 V scalar**, **0.014 A terminal scalars**, guessed X1/X2 justification and complete-coverage claim. Exact 14 mA consumption is now supported, but retained only as a characteristic in notes. The rated supply range, operating limits and 50/60 Hz alternatives also remain notes; no arbitrary scalar selects one value. Ui 600 V at pollution degree 3 and Uimp 6 kV are insulation capabilities, not supply setpoints.

Original source claims, result, research and type are preserved under `original/` with hashes; the unsupported ZBVM4 transfer is rejected rather than repeated in the corrected accepted-source list. Source URLs in `result.json` point to exact ZB4BVM6 evidence and explicitly applicable catalog/circuit/mounting material. Private full documents and inspected images are under `references/`; full-page renders and text remain in `../../reviewer-0400/`.

The original worker files are unchanged and copied job/schema bytes are identical. Files are formatted; no central verification, canonical edits or repository tests were run. `frozen-sha256.json` records the candidate handed to the coordinator.
