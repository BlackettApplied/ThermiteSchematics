# lc1-dt25p7 — Schneider LC1-DT25P7

Decision: **candidate**, with partial physical connection coverage. Proposed type ID: `schneider-pilot:lc1-dt25p7`; manufacturer: `Schneider Electric`; retained source order: `LC1-DT25P7`.

The manufacturer spells this order **LC1DT25P7**. Treating the source hyphen as a presentation separator is supported by the exact product sheet and B8 selection row plus P7 coil table; no successor or alternate suffix is substituted. The historical description agrees with the manufacturer evidence.

## Evidence

- **S1 — Manufacturer product page:** https://www.se.com/uk/en/product/LC1DT25P7/tesys-d-contactor-4p4-no-ac1-440-v-25-a-230-v-ac-50-60-hz-coil/. Title: “TeSys D contactor - 4P(4 NO) - AC-1 - <= 440 V 25 A - 230 V AC 50/60 Hz coil”. Undated live page, opened 2026-09-11. Confirms exact manufacturer spelling and headline configuration.
- **S2 — Schneider-authored product data sheet, distributor mirror:** https://shop.stevenengineering.com/storefrontContent/imagespdf/Schneider%20Electric/Schneider-LC1DT25P7_DATASHEET_US_en-US.pdf. “Product data sheet — Characteristics — LC1DT25P7”, dated August 17, 2021, PDF pp. 1–3. Opened with the web tool; direct archival download returned HTTP 403. Specifies four NO main poles, 1 NO + 1 NC auxiliaries, and a 230 V AC 50/60 Hz coil. Main AC-1 duty is 25 A at <=440 V and 60 °C; voltage capability also lists <=690 V AC and <=300 V DC, without establishing 25 A at those limits. No terminal diagram reviewed in this sheet.
- **S3 — Manufacturer catalog:** https://iportal2.schneider-electric.com/Contents/docs/B8_CONTACTORS_EN_CATALOGUE.PDF (redirects to https://iportal.se.com/Contents/docs/B8_CONTACTORS_EN_CATALOGUE.PDF). “TeSys D, SK, K, SKGC, GC, GY, GF Contactors”, Chapter B8. No publication revision/date visible on inspected cover or cited pages. Saved as `references/b8.pdf`, with extraction and rendered evidence. Visually inspected physical/printed pages 1 (chapter cover), 12 (selection row and P7 table), and 79 (applicable scheme 127267.eps), then enlarged the relevant p.79 diagram at 600 DPI. Page 12 selects LC1DT25 with four NO main poles and 1 NO + 1 NC auxiliary; P7 explicitly means 230 V, 50/60 Hz AC. Its scheme pointer leads to p.79, whose LC1DT20–DT80A diagram includes this exact selected size. This is not the neighboring 2 NO + 2 NC variant.

## Independently recorded connection and continuity specification

| Function             | Diagram terminal marks | Rest state         |
| -------------------- | ---------------------- | ------------------ |
| Coil                 | A1, A2                 | 230 V AC, 50/60 Hz |
| Main pole 1          | 1/L1, 2/T1             | Open               |
| Main pole 2          | 3/L2, 4/T2             | Open               |
| Main pole 3          | 5/L3, 6/T3             | Open               |
| Main pole 4          | 7/L4, 8/T4             | Open               |
| Factory auxiliary NO | 13/NO, 14              | Open               |
| Factory auxiliary NC | 21/NC, 22              | Closed             |

These 14 circuit endpoint keys preserve the diagram labels, including the functional suffixes. No phase assignment beyond printed labels is asserted. The dashed actuation line is mechanical. Factory fixed links: **none documented among these distinct endpoints**. Neither the coil impedance nor a normally closed contact is a permanent net join. Contact use is application-dependent; A1 and A2 are required for the modeled electrically operated contactor.

## Scope and remaining uncertainty

All documented main and factory auxiliary contacts and coil endpoints are modeled, using existing coil/contact symbols. No add-on contact blocks, suppression accessories, PE, shield or communication connections are asserted. B8 p.12 distinguishes integral suppression on DC versions and specified larger AC sizes; this does not justify adding a suppressor or polarity to P7. The applicable scheme shows a plain coil.

Physical coverage remains **partial**: the selected circuit diagram does not enumerate possible duplicate coil access/clamping positions or accessory-interface contacts on every historical hardware revision. No duplicate terminal or internal short between imagined access points is invented. Physical rear/front coil-access inventory would require the exact-version installation drawing. This limitation does not obscure the verified circuit endpoints.

Only the coil carries nominal 230 V AC metadata. Contact capability remains in notes to avoid treating a voltage ceiling as an assigned circuit voltage, or applying a conditional AC-1 current to all loads. No central verification, build, installation or test project was run. The initial web fetch of B8 failed, but the supplied research downloader obtained the manufacturer PDF successfully; optional product-image web fetches also failed and are not evidence.
