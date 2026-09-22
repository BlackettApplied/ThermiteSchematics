# lc1-dt20p7 — candidate

Identity: **Schneider Electric LC1-DT20P7**, proposed type `schneider-pilot:lc1-dt20p7`. Manufacturer spelling is **LC1DT20P7**. The source hyphen is treated as a presentation separator: the exact unhyphenated datasheet and catalog selection LC1DT20 + P7 match all source attributes (4 poles, 20 A AC-1, 230 V AC 50/60 Hz, 1NO + 1NC auxiliaries). The required source spelling remains in catalog.orderNumber. No successor substitution or source-description disagreement was found.

## Evidence inspected

- **S1:** [Schneider Electric product data sheet, LC1DT20P7](https://www.mecampbell.com/media/pdf/fb7f087d4097d29718e63a119a005d5692fa1a29.pdf), dated **Jan 14, 2020**, physical pages 1–4; manufacturer-authored document at **M. E. Campbell distributor mirror**. Local `references/product.pdf` and extracted text. Page 2 establishes 4NO main poles, 1NO + 1NC auxiliaries and 230 V AC 50/60 Hz coil. Page 3 establishes screw-clamp connections and **without built-in suppressor module**. This sheet has no applicable terminal circuit diagram.
- **S2:** [TeSys D, SK, K, SKGC, GC, GY, GF Contactors, Chapter B8](https://iportal2.schneider-electric.com/Contents/docs/B8_CONTACTORS_EN_CATALOGUE.PDF), undated chapter extract; no revision/date visible on inspected chapter cover or relevant pages. Requested URL redirects to `https://iportal.se.com/Contents/docs/B8_CONTACTORS_EN_CATALOGUE.PDF`. Physical and printed pages **1/B8/1, 12/B8/12, 79/B8/79** inspected visually. Page 12 exact LC1DT20 row gives four NO poles, one NO and one NC auxiliary, screw clamps; P7 is 230 V AC 50/60 Hz. Its scheme reference leads to page 79, **diagram 127267.eps, LC1DT20 to DT80A**. Full-page context and enlarged exact diagram inspected (`references/b8-page-79-clip-45_220_175_305-400dpi.png`). The separate neighboring 2NO+2NC diagram was not used.
- **S3:** [Schneider Electric Singapore exact product listing](https://eshop.se.com/sg/contactor-tesys-deca-4p-4-no-ac-1-lt-440v-20a-230vac-50-60hz-coil-screw-clamp-terminal-lc1dt20p7.html), undated, accessed 2026-09-11. Opened page identifies LC1DT20P7, 4NO, 20 A AC-1 and 230 V AC 50/60 Hz. The opened response omitted detailed specifications; search-result-only details were not used as evidence.

## Independently established connections and continuity

| Function          | Manufacturer diagram endpoints | Rest state         |
| ----------------- | ------------------------------ | ------------------ |
| Main pole 1       | 1/L1 — 2/T1                    | NO                 |
| Main pole 2       | 3/L2 — 4/T2                    | NO                 |
| Main pole 3       | 5/L3 — 6/T3                    | NO                 |
| Main pole 4       | 7/L4 — 8/T4                    | NO                 |
| Factory auxiliary | 13/NO — 14                     | NO                 |
| Factory auxiliary | 21/NC — 22                     | NC                 |
| Coil              | A1 — A2                        | 230 V AC, 50/60 Hz |

Fourteen documented circuit endpoints. Keys preserve diagram markings, including `/NO` and `/NC`; no inferred phase assignment. All six contacts are mechanically actuated by the coil. **No fixed links**: neither NC rest-state conduction nor coil impedance is a permanent conductor; the dashed actuation line and linked auxiliary mechanism are not wires. No accessory terminals are included. No PE, shield or communications endpoint is documented for this contactor.

Coverage is **partial**: the circuit inventory is established, but the sources do not settle all physical access points, particularly duplicated coil access and any resulting factory link. No duplicate terminals or links are invented. This is a circuit abstraction, not an exhaustive clamp-position map or as-built assembly. Optional suppression/accessories and site bonding are outside it. All endpoints are application-dependent; none is universally required by this type.

## Ratings and model scope

S1 p2 and S2 p12: 20 A AC-1 non-inductive load at up to 60 °C and <=440 V AC. S1 p2 separately lists power-circuit capability <=690 V AC (25–400 Hz), <=300 V DC; these are not assigned nominal operating voltages or a claim of 20 A switching at every voltage. Auxiliary thermal current is 10 A at 60 °C, not a universal switching-current limit. These conditional capabilities remain notes rather than scalar contact ratings. Coil alone carries nominal_voltage 230 and voltage_type AC; its dual 50/60 Hz capability remains notes. S1 p3 specifies no built-in suppressor, so no suppression function or polarity is invented.

All seven functions use existing coil/contact-no/contact-nc circuit symbols; coil-to-contact relations express mechanical actuation only. Central verification is left to the coordinator. No installs, builds, tests, git operations or bespoke project were run.

The catalog exceeded the web viewer size limit but was successfully fetched with research-tools.py. Exact datasheet obtained from the identified manufacturer mirror; further speculative variant searches were unnecessary. Remaining evidence needed for complete physical coverage: an applicable physical terminal/access drawing documenting any duplicate coil clamps and their internal connections.

## Library connection policy

The coordinator marks A1 and A2 required for an electrically operated contactor. Individual passive contacts remain application-dependent. This consistent diagnostic policy does not establish a circuit supply or an installed connection.
