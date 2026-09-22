# zb4-bw0b45 — Schneider ZB4-BW0B45

Decision: **candidate**, partial collar/bonding coverage.

## Coordinator evidence recovery

The [exact manufacturer datasheet](https://www.se.com/au/en/product/download-pdf/ZB4BW0B45), dated12 September2026, was retrieved directly and its alternate product views on pages7–9 visually inspected. Page7 shows all six clamps; page8 shows the constituent NO diagram. This closes the initial terminal-marking gap for a scoped functional model. Color comes from the exact specification and historical catalog row, not the appearance of the alternate lamp image.

- Source ZB4-BW0B45 is retained. Exact manufacturer ZB4BW0B45 identifies a red integral-LED body with fixing collar,24 V AC/DC and1NO+1NC. Matching alphanumeric code and exact composition support punctuation correspondence; no successor or different voltage/color is substituted.
- The October2021 catalog physical86/printed84 confirms this body/contact/light composition. An operator head, added contact blocks and optional test accessories are separate; no particular pushbutton or selector actuation or universal contact gang is assigned.
- Exact-product datasheet dated12 September2026, page7 rear view, shows NO3/4, lampX1/X2 and NC1/2 as six separate screw clamps. Page8 side view has the NO3-4 body diagram. Model keys follow those physical markings. The earlier and current ISO text field says only11-12 NC; that documentary discrepancy is retained without inventing more clamps or formal aliases.
- The datasheet calls these alternate images; the pictured lamp looks green even though the exact specification says red. Use its correctly composed NO/NC/lamp terminal view as manufacturer-associated interface evidence, not proof of the installed LED color, production revision or an itemized internal bill of materials. The exact order specification governs red color.
- Lamp supply24 V AC/DC,50/60 Hz for AC; limits19.2-30 V DC and21.6-26.4 V AC,18 mA consumption. No DC polarity assignment or guaranteed polarity-insensitivity is inferred from a neighboring product.
- Passive contacts are application-dependent; lampX1/X2 are required under library policy. Neither switched contacts nor LED electronics establish permanent net continuity. No fixed links.
- Conditional contact ratings, including AC-15 at3 A/240 V and DC-13 at0.27 A/250 V, remain research notes. Thermal/insulation capabilities are not one universal switching rating.
- Class I and the included metal collar do not prove a protective bond. Attachment/collar/support earthing remains unresolved and unmodeled; no PE pin or automatic panel bond is inferred.

## Initial evidence and search record

The initial hold below records the earlier evidence gap, now closed for functional clamps by the exact-product rear view. Partial bonding and documentary discrepancies above govern the final model.

# zb4-bw0b45 — Schneider ZB4-BW0B45

Decision: **needs-evidence**. Intended identity: `schneider-pilot:zb4-bw0b45`, manufacturer `Schneider Electric`, order `ZB4-BW0B45`. No type is proposed because the complete terminal inventory and applicable connection diagram remain unresolved.

## Identity and scope

[S1 — Schneider product page](https://www.se.com/us/en/product/ZB4BW0B45/light-block-with-body-fixing-collar-harmony-xb4-metal-red-integral-led-24v-ac-dc-1no%2B1nc/), undated, accessed 2026-09-12, identifies ZB4BW0B45 as a red 24 V AC/DC LED body with fixing collar and 1 NO + 1 NC. This agrees with the historical description. It is a body assembly requiring a separately selected operator head; the source does not establish a complete pushbutton or its actuation mode. The page lists a replacement, which was not substituted.

[S2 — Harmony XB4 metal catalog](https://iportal.se.com/Contents/docs/HARMONY%20XB4%20METAL%20CONTROL%20AND%20SIGNALING%20UNITS_CATALOG.PDF), 10/2021, supplied local copy `references/schneider-xb4-2021.pdf`, printed 84 / PDF 86: exact red ZB4BW0B45 selection row confirms 24 V AC/DC, 1 NO + 1 NC, screw clamps and separately added contact blocks. The full page was rendered and visually inspected. Its illustration is labeled for a different contact composition; it cannot establish this order's numbering.

[S3 — Historical Schneider catalog, 36068-FR.indd](https://ckm-content.se.com/ckmContent/sfc/servlet.shepherd/document/download/0691H00000D9sFwQAJ), version 6.1, PDF 7 / section 36068-FR/8: opened text identifies the same selection as `ZB4 BW0B45`. The spaced historical and compact manufacturer references support the likely identity match. No opened manufacturer document explicitly establishes the source's hyphenated spelling as an alias; preserve it unchanged.

## Exact sheet and connection gaps

[S4 — Schneider Product data sheet, ZB4BW0B45](https://files.kempstoncontrols.com/files/3b74e9f6763ab7a3f77581ad29eeffae/ZB4BW0B45.pdf), 2023-10-31, manufacturer-authored **Kempston Controls mirror**, saved as `references/zb4bw0b45.pdf` with extracted text. Pages 1–2 specify slow-break contacts, NC markings 11–12, Zamak collar and screw clamps. LED supply: nominal 24 V AC/DC, 50/60 Hz; limits 19.2–30 V DC and 21.6–26.4 V AC; consumption 18 mA. Contact examples: AC-15 3 A at 240 V; DC-13 0.27 A at 250 V. These are conditional switching ratings, not a universal current limit. Class I is stated but no bonding terminal or path is identified.

Pages 5 and 7 were rendered and visually inspected: dimensional outlines and panel spacing only, without terminal identification. Thus `diagramReviewed` remains false for connection evidence. Essential missing evidence is an exact-order connection/assembly drawing identifying the NO and LED endpoints, any polarity, all physical connection points, and factory links or separation. No NO numbering, LED aliases, fixed links or PE path is inferred. Passive contacts would be application-dependent; documented LED supply points would be required by library policy.

## Search outcome / continuation

Exact-code searches with “datasheet”, “X1”, “X2”, “13 14” and “Connections and Schema” found no usable exact connection scheme. Guessed official iportal sheet URL returned 404; Schneider download endpoint returned 403; product-image links and CCA/allDatasheet PDF navigation failed through the web tool. The accessible mirror supplied dimensional drawings only. The 2021 catalog provides the exact order row but no corresponding numbered scheme. Obtain a Schneider assembly drawing or instructions explicitly tying fitted contact/light blocks and their markings to this order, plus clarification of its metal attachment/bonding interface. No type.json, wiring fixture, bespoke verifier, build or repository test was created.
