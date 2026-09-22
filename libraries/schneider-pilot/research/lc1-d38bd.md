# lc1-d38bd — candidate

Identity: **Schneider Electric LC1-D38BD**, proposed type `schneider-pilot:lc1-d38bd`. Schneider prints **LC1D38BD**. Treat the source's hyphen after LC1 as a presentation separator: the exact unhyphenated product sheet and B8 selection row plus BD suffix agree with every historical description attribute. No successor or accessory is substituted.

## Evidence reviewed

- **S1 — [Product data sheet, LC1D38BD](https://iportal.se.com/Contents/docs/SQD-LC1D38BD.PDF)**, September 14, 2017, PDF pp.1–3; saved as `references/datasheet.pdf`. Exact identity, three NO main poles, one NO and one NC auxiliary, 24 V DC standard coil. AC-3: 38 A at ≤440 V AC and ≤60 °C; AC-1: 50 A under those voltage/temperature conditions. Power circuit capability ≤690 V AC, 25–400 Hz, or ≤300 V DC. Coil consumption 5.4 W at 20 °C; built-in bidirectional peak-limiting diode suppressor. These capabilities are not assigned circuit voltages or unconditional switching limits.
- **S2 — [TeSys Contactors, chapter B8](https://iportal2.schneider-electric.com/Contents/docs/B8_CONTACTORS_EN_CATALOGUE.PDF)**, undated chapter; no revision/date visible on inspected cover or selected pages. Saved as `references/catalog.pdf`. Visually inspected physical/printed pages 1, 8 and 79. B8/8 selects LC1D38 with screw clamps and 1NO+1NC auxiliaries; its standard DC table assigns BD to 24 V. The page explicitly points to B8/79, whose three-pole LC1D09–D150 diagram 127266 establishes the terminal inventory below. Reviewed full page and 600 DPI diagram crop; adjacent four-pole and optional contact-block diagrams are excluded.
- **S3 — [Schneider FAQ FA121938: DC coil polarity](https://www.se.com/ca/en/faqs/FA121938/)**, published 2007-08-28, modified 2026-05-12; opened HTML, Resolution. A1 positive, A2 negative for LC1D***D. Bidirectional suppression does not justify ignoring these manufacturer wiring instructions.
- **S4 — [Schneider FAQ FA95490: coil connection count](https://www.se.com/us/en/faqs/FA95490/)**, published 2002-04-30, modified 2026-05-12; opened HTML, Resolution. TeSys LC1D provides one A1 and one A2, unlike the pre-TeSys version's duplicated A2.

## Independent connection and continuity specification

| Function          | Verified terminal markings | Rest state               |
| ----------------- | -------------------------- | ------------------------ |
| Main pole 1       | 1/L1 — 2/T1                | NO                       |
| Main pole 2       | 3/L2 — 4/T2                | NO                       |
| Main pole 3       | 5/L3 — 6/T3                | NO                       |
| Factory auxiliary | 13/NO — 14                 | NO                       |
| Factory auxiliary | 21/NC — 22                 | NC                       |
| DC coil           | A1 — A2                    | A1 positive; A2 negative |

Complete coverage for the standard factory contactor's 12 external electrical connections. Keys preserve S2 markings; no invented phase orientation, PE, shield, communication, duplicate coil terminals or optional add-on contacts. **No fixed net links.** Coil actuation and linked auxiliary mechanics are functional relationships; the NC contact remains switched. Neither winding nor suppressor is a wire. The suppressor is recorded in notes within the coil abstraction; its transient electrical behavior has no supported separate circuit function here.

All six functions use existing coil/contact circuit marks. No terminal is declared universally required: coil operation needs both A1/A2 wired, but this proposal does not impose an application or insist that every power/auxiliary contact be used. Only coil terminals carry nominal 24 V DC metadata. Contact voltage/current capabilities remain conditional notes.

## Limitations and search record

The source and manufacturer agree on electrical composition and coil supply; spelling differs only as discussed above. No as-built condition, installed accessory, contact endurance or installation suitability is established. The chapter's publication revision remains unspecified. Schneider instruction-sheet download page `https://www.se.com/uk/en/download/document/1378323_01A55/` opened (A14, 2021-10-01), but downloads for 1378323_01A55 and 1378304_01A55 returned HTTP 403. No claims depend on those inaccessible instructions; S2 and S4 resolve diagram applicability and coil access count. Web opening of the full B8 PDF exceeded its size limit; the provided research tool successfully downloaded it for local visual review.

## Library connection policy

The coordinator marks A1 and A2 required for an electrically operated contactor. Individual passive contacts remain application-dependent. This consistent diagnostic policy does not establish a circuit supply or an installed connection.
