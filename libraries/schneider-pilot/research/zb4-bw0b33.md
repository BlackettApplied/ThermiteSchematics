# zb4-bw0b33 — Schneider ZB4-BW0B33

Decision: **candidate**, partial collar/bonding coverage.

## Exact evidence recovery

The original research confirmed the order and composition but could not locate all physical terminal markings. The coordinator retrieved the [exact manufacturer datasheet](https://www.se.com/au/en/product/download-pdf/ZB4BW0B33), dated12 September2026, and visually inspected pages1,7,8,9. Page9 shows the rear end face with all six clamps and a side-view NO3–4 diagram. These are manufacturer-assigned alternate images attached to this exact order; they corroborate the green24 V,2NO composition in the historical October2021 catalog physical86/printed84 and earlier exact sheets.

- Source ZB4-BW0B33 is retained. Manufacturer ZB4BW0B33 has the same alphanumeric code, green 24 V AC/DC LED and two NO contacts; punctuation correspondence is a documented identity inference, not a replacement order.
- Exact body/contact/light assembly includes the metal fixing collar. The operator head, added contact blocks and optional test accessories are separate. No pushbutton/selector motion or universal mechanical contact gang is assigned to this bare body.
- Manufacturer product datasheet dated 12 September 2026, page 9 rear view, shows two NO contact blocks, each physically marked 3 and 4, with the central lamp marked X1 and X2. Its separate ISO text field mentions only 13-14; these labels are not modeled as extra physical clamps or asserted aliases.
- B1 and B2 are model-only block qualifiers for the photo-left and photo-right NO blocks, respectively, while looking at the rear screw terminals with NO3/X1 above 4/X2 as in the cited page 9. Printed terminal markings remain 3 and 4 on both blocks. The qualifiers are not manufacturer legends.
- Lamp nominal supply 24 V AC/DC, 50/60 Hz for AC. Exact sheet operating limits are 19.2-30 V DC and 21.6-26.4 V AC, consumption 18 mA. No DC polarity assignment or universal reverse-polarity guarantee is inferred from the unpolarized labels.
- Passive contacts are application-dependent. Both lamp terminals are required for the modeled operating lamp under library policy. Neither the lamp nor either normally open contact creates a permanent net link.
- Contact ratings remain conditional: AC-15/A600 6 A at120 V,3 A at240 V,1.2 A at600 V; DC-13/Q600 0.55 A at125 V,0.27 A at250 V,0.1 A at600 V. Ith10 A and Ui600 V are thermal/insulation capabilities, not one universal switching rating.
- Class I and Zamak collar do not establish an installed protective bond. Collar/support bonding and any associated attachment interface remain outside the documented electrical model; no PE clamp or automatic panel bond is invented.
- The current exact-product datasheet labels its additional views as alternate images. Their matching two-NO and lamp composition corroborates the exact historical selection; no unlisted internal bill of materials or installed production revision is asserted.

## Earlier evidence and search record

The earlier hold below describes the initial missing evidence, which the exact-product rear view now closes for the modeled functional clamps. Partial bonding and the stated documentary discrepancies remain.

# zb4-bw0b33 — Schneider Electric ZB4-BW0B33

Decision: **needs-evidence**. Intended type ID: `schneider-pilot:zb4-bw0b33`. No `type.json` is justified because the exact assembly's complete terminal markings and applicable connection diagram remain unverified.

## Evidence reviewed

- **S1 — [Schneider Electric product page, ZB4BW0B33](https://www.se.com/us/en/product/ZB4BW0B33/light-block-with-body-fixing-collar-harmony-xb4-metal-green-integral-led-24v-ac-dc-2no/)**, undated live page, accessed 2026-09-12. Identifies a green integral-LED light block with fixing collar, 24 V AC/DC and 2 NO contacts. The replacement displayed on this page is a different order and was not substituted.
- **S2 — [Harmony XB4 metal control and signaling units catalog](https://iportal.se.com/Contents/docs/HARMONY%20XB4%20METAL%20CONTROL%20AND%20SIGNALING%20UNITS_CATALOG.PDF)**, supplied official 10/2021 edition, printed p.84 / physical PDF p.86. Visually inspected the full selection page in `references/schneider-xb4-2021-page-86.png`. The exact ZB4BW0B33 row specifies green, 24 V AC/DC (50/60 Hz AC), two NO contacts, screw-clamp connections and 0.074 kg. This is a body/contact/light assembly to combine with separately selected heads. Additional contact blocks are optional. The page contains a product photograph and unnumbered contact symbols, not a terminal scheme.
- **S3 — [ZB4BW0B33 product datasheet](https://www.farnell.com/datasheets/2113129.pdf)**, undated, physical pp.1–3; Schneider-authored document at Farnell mirror, saved as `references/zb4bw0b33-farnell.pdf`. Confirms the composite assembly and slow-break NO contacts. Its terminal-description field gives only `(13-14)NO`, despite specifying two NO contacts. It does not identify the second contact pair or LED terminals. No complete electrical connection diagram appears in the sheet.
- **S4 — [ZB4BW0B33 product data sheet](https://www.y-ic.kr/datasheet/90/ZB4BW0B33.pdf)**, 2022-01-13, physical pp.1–5; Schneider-authored document at Y-IC mirror, saved as `references/zb4bw0b33-yic.pdf`. Again lists only `(13-14)NO`. Visually inspected pp.4–5: side dimensions and panel cut-out drawings, without numbered electrical endpoints. These mechanical drawings do not establish a PE connection. `diagramReviewed` remains false because no relevant connection diagram was inspected.

## Established scope and limits

It does not justify adding an operator head. Manufacturer documents opened use `ZB4BW0B33`; the requested identity remains `ZB4-BW0B33`. A historical manufacturer document explicitly printing the hyphenated code was discovered but could not be opened, so punctuation equivalence is not conclusively documented here.

S4 specifies LED supply limits of 19.2–30 V DC and 21.6–26.4 V AC, consumption 18 mA. Contact ratings are conditional: AC-15/A600, 6 A at 120 V, 3 A at 240 V, 1.2 A at 600 V; DC-13/Q600, 0.55 A at 125 V, 0.27 A at 250 V, 0.1 A at 600 V. These are not a single assigned contact voltage/current. S3 and S4 disagree on minimum operating temperature (−25 °C versus −40 °C); neither value is modeled.

Required next evidence: an exact-order wiring/terminal drawing identifying both NO pairs and both LED connections, including repeated markings or block qualifiers; clarification of the metal collar's bonding interface (S3/S4 state Class I but do not document its bond arrangement); and accessible historical spelling evidence. Do not infer a second pair numbered 23–24, LED labels X1/X2, polarity, shared commons, or a PE screw. No factory links are established. Switch contacts and the LED must not be represented as permanent net joins. A later justified model can use two `contact-no` functions and one `lamp` function; passive contacts are application-dependent, while verified lamp supply points would be required by the job policy.

## Searches that did not close the gap

Exact-code manufacturer searches found the product page and selection table, but no complete terminal scheme. The guessed iportal exact-product sheet could not open; the Schneider download endpoint returned HTTP 403. Both accessible exact-product mirror sheets omit the essential diagram. DatasheetArchive and alternate mirror web opens failed. The historical Schneider/Telemecanique Spanish catalog lead at `https://obj.construmatica.com/construmatica/business/files/28205/control_industrial_y_automatizacion/dialogo_operador/catalogos/catalogo_mando_y_senalizacion_harmony.pdf` could not be fetched (DNS failure) or opened by the web tool. Its search snippet is not accepted evidence. No adjacent order's terminals were transferred. No installs, builds, tests, git operations or shared-library changes were performed.
