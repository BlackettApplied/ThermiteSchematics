# lad-n22 — Schneider LAD-N22

Decision: **candidate**. Schneider publishes **LADN22**. The source's LAD-N22 is treated as presentation punctuation: the unchanged alphanumeric reference and its front-mounted 2NO + 2NC description match the exact manufacturer selection row. This is an explicitly recorded identity interpretation, not a successor or suffixed-variant substitution. The requested catalog order remains LAD-N22; type ID is schneider-pilot:lad-n22.

## Evidence reviewed

- **S1 — Schneider Electric, TeSys D, SK, K, SKGC, GC, GY, GF Contactors, chapter B8**, [manufacturer PDF](https://iportal2.schneider-electric.com/Contents/docs/B8_CONTACTORS_EN_CATALOGUE.PDF). No publication date/revision is printed on the inspected chapter opener or relevant pages; accessed 2026-09-11. Physical pages 1, 22 and 79 equal printed B8/1, B8/22 and B8/79. Page 22 selects LADN22 as a front clip-on instantaneous four-contact, 2NO + 2NC screw-clamp block. Page 79 explicitly labels its corresponding diagram LADN22 (drawing 127273.eps). Full pages were visually inspected, followed by a 400-DPI crop of that exact diagram (PDF rectangle 175,418,298,493). Local evidence: references/b8.pdf and rendered pages/crop.
- **S2 — Schneider Electric, Product data sheet / Specifications, LADN22**, [manufacturer PDF](https://www.se.com/us/en/product/download-pdf/LADN22), dated Sep 11, 2026, pages 1–2. Both pages visually inspected. Confirms front mounting, instantaneous 2NO + 2NC, screw clamps, and the eight physical contact terminals in the product photograph. Local evidence: references/ladn22.pdf, extracted text and rendered pages. Current TeSys Deca branding differs from the B8 TeSys D branding; terminal topology agrees.
- **S3 — Schneider Electric FAQ FA116636**, [terminal identification](https://www.se.com/us/en/faqs/FA116636/), published 2006-06-07, modified 2026-08-22; unpaginated Resolution section opened. Independently confirms both NO and both NC terminal pairs. This is text corroboration, not the visually reviewed diagram.

## Independently established connection inventory

| Contact | Manufacturer terminal marks | Normal state |
| ------- | --------------------------- | ------------ |
| First   | 53 (NO), 54                 | Open         |
| Second  | 61 (NC), 62                 | Closed       |
| Third   | 71 (NC), 72                 | Closed       |
| Fourth  | 83 (NO), 84                 | Open         |

Complete coverage for this auxiliary block: eight screw-clamp terminals, four mechanically ganged contact functions. Numeric terminal keys preserve the manufacturer numbers; NO/NC are contact-state annotations. No coil, main power poles, supply/return, PE/bond, shield or communication interfaces belong to this block's documented inventory. The host contactor and its connections are separately specified. No additional accessory is included.

**Factory fixed links: none.** The diagram's common actuation line is mechanical. NC resting conduction and moving NO contacts are switched paths, never permanent net joins. All contact terminals are application-dependent, so none is universally required. Each function uses an existing contact-no/contact-nc circuit symbol; ganged_with relations record mechanical association only.

## Ratings and limits

S2 p.1: AC-15 operational current is 6 A at 120 V and 1.04 A at 690 V; DC-13 is 0.55 A at 125 V and 0.1 A at 600 V. Conventional free-air thermal current is 10 A at 60 °C. Listed Ue is 690 V AC, 25–400 Hz; Ui is 690 V to IEC 60947-5-1 and 600 V to UL/CSA. These are conditional capabilities, not an assigned circuit voltage or universal switching current; scalar terminal ratings are omitted.

S2 p.2: minimum switching values 17 V and 5 mA; screw tightening torque 1.7 N·m. One flexible conductor with/without end fitting: 1–4 mm²; two flexible conductors with end fittings: 1–2.5 mm² each, without: 1–4 mm² each; one or two rigid conductors without fittings: 1–4 mm² each. Shared connection policy represents this supported multi-conductor clamp, without inventing duplicate terminals. Current hardware appearance and ratings do not certify the historical installed specimen.

No essential connection uncertainty remains. The web PDF opener rejected the 16.9 MB B8 catalog as too large; research-tools.py successfully downloaded it from Schneider for local inspection. Central fixture, compiler and rendering verification are left to the coordinator.
