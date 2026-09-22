# zbvb3 — Schneider ZBVB3

**Candidate: bare green 24 V AC/DC LED light block, with physical supply terminals X1 and X2.** One lamp/load function represents the light circuit, both supply terminals are required under library policy, and there are no fixed links. Connection coverage is complete for this bare block. The separately ordered head, collar and their bonding remain outside its scope.

## Identity and historical specification

The source order is **ZBVB3**, described as green, 24 V AC/DC, with “increased intensity of light.” The [exact Schneider datasheet SQD-ZBVB3, 1 February 2016](https://iportal2.schneider-electric.com/Contents/docs/SQD-ZBVB3.PDF) identifies a Harmony XB4/XB5 light block with direct supply, green protected integral LED, steady indication and screw-clamp terminals. The [October 2021 Harmony XB4 catalogue](https://iportal.se.com/Contents/docs/HARMONY%20XB4%20METAL%20CONTROL%20AND%20SIGNALING%20UNITS_CATALOG.PDF), physical page 79 / printed 77, independently lists the exact green 24 V AC/DC ZBVB3 module. A current replacement or different color is not substituted.

The exact specifications give **24 V AC/DC**, **50/60 Hz for AC**, and separate operating limits of **21.6–26.4 V AC** and **19.2–30 V DC**. They state 18 mA consumption, 100,000 h service life at rated voltage and 25 °C, IP20, front mounting, screw torque 0.8–1.2 N·m, and conductor conditions of at least 1 × 0.22 mm² without cable end and at most 2 × 1.5 mm² with cable end. These remain conditional documentary values.

The source phrase “increased intensity of light” is not established by the exact catalogue or datasheet, which describe the standard protected integral LED. That wording discrepancy is retained without inventing an enhanced-brightness variant.

## Physical terminal evidence

The [exact current manufacturer ZBVB3 PDF](https://www.se.com/au/en/product/download-pdf/ZBVB3), dated **12 September 2026**, supplies the terminal evidence:

- The page 1 product photograph, extracted at native resolution, shows a body-printed lamp schematic labeled **X1 and X2**.
- The page 6 application photograph independently shows the two supply screw labels **X1 and X2**.

These images were independently visually inspected. The product photograph is marked with the generic **ZBV** family designation, and the application image does not prove an installed production revision, color or recommended wiring arrangement. The images establish the physical endpoint names and lamp topology associated by Schneider with this exact order; historical exact-order specifications establish its green 24 V identity.

The old datasheet's page 3 shows **side dimensional outlines with two alternative fixing collars**, ZB5AZ009 and ZB4BZ009. Those outlines are not a labeled electrical diagram and do not identify “two terminal blades.” That source's `diagramReviewed` flag is false. The recovered current body diagram is the positive electrical-diagram evidence and retains `diagramReviewed: true`.

## Model and limits

X1 and X2 are **supported physical labels**, not functional aliases. Both are required for the modeled operating lamp under the job's explicit library policy. They remain electrically distinct; a load function does not join their physical nets. There are no contact functions, coil, PE, shield or communication terminals in this bare-block model. Its clip attachment is mechanical. Bonding of separately chosen head/collar/panel hardware must be addressed by the containing project or assembly.

The type retains **nominal voltage 24 V**. It omits a scalar `voltage_type` because the schema only permits one AC or DC value, while the product supports both. AC frequency and voltage limits remain notes.

The manufacturer-associated photograph states **14 mA**, while exact product text states **18 mA**. Both observations remain documented, but **no current scalar is assigned**. Neither value is treated as an unconditional current limit or proof of the installed revision.

No mandatory DC polarity assignment or guarantee of reverse-polarity tolerance is established by the reviewed exact-order evidence. AC/DC capability alone does not establish that either DC orientation is acceptable. The model therefore assigns no +/− aliases and makes no polarity-insensitivity claim.

## Review and preservation

This revision reconciles the research and result with the existing corrected type. `type.json`, `job.json` and `candidate.schema.json` are byte-identical copies of the previous followup. The previous followup and canonical files remain untouched by this revision author.

Evidence is preserved in the batch's original `zbvb3/references` and `coordinator/recovery-0416/references` directories. The latter's `source.json` records the retrieved current PDF hash, and its native product image and page renders preserve the inspected evidence. No PDF or image was edited.

No central verification or tests were run. The coordinator owns archival, fresh verification and promotion.
