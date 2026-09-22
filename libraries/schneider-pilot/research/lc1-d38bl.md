# Schneider LC1D38BL — lc1-d38bl

The exact source order `LC1-D38BL` corresponds to Schneider's spelling `LC1D38BL`: TeSys D, 3 normally open main poles, factory 1NO+1NC auxiliary, and a **24 VDC low-consumption BL coil**. The source hyphen is retained in the catalog identity. No BD, BBE, BNE or successor coil data is substituted.

The candidate has twelve field-wiring terminals and six circuit functions. **A1 is positive and A2 is negative.** The standard built-in bidirectional peak-limiting suppressor is removable. Its two unnumbered accessory mating ends are not individually mapped, so coverage of all physical electrical interfaces remains **partial**.

## Evidence

The original PDFs, independently inspected images, crop metadata and extracted text are under `references/`. `sources.json` records exact URLs, source authority, file sizes and SHA-256 hashes. Page numbers below are one-based physical PDF pages.

| Source                                                                                                                                                                                                                                         | Applicable evidence                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1: [Schneider LC1D38BL exact product data sheet](https://iportal.se.com/Contents/docs/SQD-LC1D38BL.PDF), 12 March 2018, four pages                                                                                                            | Exact BL identity, 24 VDC low-consumption coil, 3NO main poles and 1NO+1NC factory auxiliary on page 1; exact coil, suppressor and auxiliary conditions on page 3. Both pages visually inspected. The illustrative photo is not used as pin proof.                                                                                                            |
| S2: [Schneider B8 contactor catalogue](https://iportal2.schneider-electric.com/Contents/docs/B8_CONTACTORS_EN_CATALOGUE.PDF), 126 pages; no independently verified printed edition date, metadata July 2020                                    | Visually inspected exact LC1D38 and BL=24 VDC selection on B8/8, standard removable suppression on B8/24, accessory distinction on B8/25–26, and the applicable LC1D09–D150 three-pole schematic on B8/79, which explicitly refers to B8/8–11.                                                                                                                |
| S3: [Schneider 137830401A55-10 instruction, RS mirror](https://docs.rs-online.com/27c0/A700000008089423.pdf), two pages; printed `W9 1378304 0211 A09`, `03/2017`                                                                              | Page 1 and 400 DPI crop visually inspected. The instruction includes `LC` in its low-consumption accessory scope and explicitly identifies physical coil screws A1+ and A2−. Its DC branch depicts the removable side suppressor, and the three-pole circuit shows all twelve field terminals. This is manufacturer-authored historical instruction evidence. |
| S4: [Schneider 137830401A55-14 instruction, distributor mirror](https://media.distributordatasolutions.com/schneider_synd_rework/2024q1/documents/67d37b36a6d78aa3e0fb15680e7b3b054f90d2ae.pdf), two pages; actual file printed A14, `05-2022` | Page 1 and 300 DPI crop corroborate A1+/A2−, LC scope, removable DC suppressor and the full applicable schematic. The mirror's actual printed May revision is distinguished from an indexed March listing; direct primary download failed.                                                                                                                    |
| S5: [Schneider FAQ FA95490](https://www.se.com/us/en/faqs/FA95490/), published 30 April 2002, modified 12 May 2026                                                                                                                             | The TeSys LC1D provides one A1 and one A2 connection point; no duplicate pre-TeSys A2 terminal is transferred. Read through the web tool.                                                                                                                                                                                                                     |

S1 is the exact-order identity/rating authority. S2's exact selection row establishes the applicability of its contact diagram. S3's historical LC1D instruction is the applicable physical coil-marking authority and explicitly includes low-consumption scope; S4 corroborates it. A BD-only FAQ, another BL relay's FAQ and a separate PLC-interface module's reverse-polarity protection are not used to establish this coil's polarity. The bidirectional clamp itself does not establish polarity-insensitivity.

## Field terminal inventory

| Function             | Modeled keys   | Manufacturer mark and behavior                     |
| -------------------- | -------------- | -------------------------------------------------- |
| Main pole 1          | `1/L1`, `2/T1` | Normally open power contact                        |
| Main pole 2          | `3/L2`, `4/T2` | Normally open power contact                        |
| Main pole 3          | `5/L3`, `6/T3` | Normally open power contact                        |
| Factory NO auxiliary | `13`, `14`     | `13/NO`–`14`, normally open                        |
| Factory NC auxiliary | `21`, `22`     | `21/NC`–`22`, normally closed                      |
| Coil                 | `A1`, `A2`     | A1+ positive, A2− negative; 24 VDC low-consumption |

`A1+` and `A2-` are polarity-labelled aliases of A1 and A2; `13/NO` and `21/NC` identify the same single endpoints modeled by keys 13 and 21. They are documented in descriptions/notes, not implemented as extra terminals or unsupported terminal-alias fields. Main keys preserve their full printed slash labels. No protective-earth, shield or communication connection is identified in this base contactor circuit.

The coil function mechanically actuates all five contact functions. Three main NO, one auxiliary NO and one auxiliary NC use existing contact symbols; the coil uses the existing coil symbol. Their mechanical actuation, the resting NC state, coil winding and suppression circuit do not imply permanent electrical continuity. **No fixed links are asserted.**

A1 and A2 are required as explicit library policy for an operating instance of this contactor. The project selects which power and auxiliary contacts it uses, so those endpoints are explicitly not required. This is a modeling policy, not a manufacturer instruction to energize every unused device. Documented textual polarity is not a substitute for project wiring verification.

## Suppression and physical scope

S1 page 3 and S2 B8/8 confirm a standard bidirectional peak-limiting suppressor. S2 B8/24 expressly includes DC low-consumption coils in the removable/replaceable scope. It lists LAD4TBDL for 24 VDC; the optional LAD4DDL flywheel diode is a distinct construction. The catalogue specifies a LAD9DL blanking plug if suppression is removed and the contactor is used without it. The actual source unit has not been inspected.

The instruction drawing shows the suppressor's two unnumbered mating ends entering the side cavity; the catalogue says the clip action makes an electrical connection and locates suppression across the coil. Their individual endpoint bindings are not numbered or mapped in the evidence. They are physical electrical contacts, but not extra field-wiring screws. The modeled inventory contains one A1 and one A2 and does not fabricate duplicate feed links, numbered suppression pins, or an A1–A2 short.

Optional LAD4BB adapters and other add-ons are outside this order's field-terminal model. The instruction places LAD4BB on the AC branch; it is not assumed present on the BL unit. `connectionCoverage.status` is `partial` because the accessory mating interface is not enumerated, despite complete established field-screw and circuit-function coverage. Suppressor semiconductor geometry and replacement state are described, not simulated.

## Conditional ratings and limits

The exact 2018 sheet gives main 38 A AC-3 and 50 A AC-1 at up to 440 VAC and up to 60 °C; 18.5 kW at 380–400 VAC is an AC-3 motor condition. Maximum main operating voltage up to 690 VAC at 25–400 Hz or 300 VDC and insulation capabilities are not nominal circuit supplies. Main and signal thermal-current limits remain separate.

The genuine nominal coil supply is 24 VDC. Exact-order page 3 states 2.4 W inrush and holding at 20 °C, operation 0.8–1.25 Uc and dropout 0.1–0.3 Uc at 60 °C, 40 ms time constant, closing 65.45–88.55 ms and opening 20–30 ms. This exact-order data is used instead of flattening a general comparison table or transferring the adjacent standard-DC 0.7 Uc lower limit.

Auxiliary minimum signal is 17 V/5 mA. The exact sheet separately qualifies mechanically linked NO/NC auxiliaries and an NC mirror contact; these do not create net links or a general suitability claim. It lists operating ambient −5…60 °C. Conditional contact, wiring and torque ratings remain documentary; only coil 24 VDC is scalar terminal metadata.

## Review outcome

Candidate after independent correction. The completed original had the correct twelve-terminal topology and no fixed joins, but left polarity unresolved and overstated physical coverage as complete. This followup resolves polarity from the historical installation drawing, records descriptive aliases without added endpoints, changes physical coverage to partial and uses exact-order coil limits. Original worker files were preserved with hashes in the sibling reviewer directory.
