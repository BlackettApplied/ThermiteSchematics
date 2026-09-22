# lc1-d80bd — Schneider LC1-D80BD

Decision: **candidate**, with partial physical connection coverage.

## Evidence and identity

**S1:** Schneider Electric, _Product data sheet — LC1D80BD_, September 20, 2017, physical/printed pages 1–3 and 6. [Manufacturer PDF](https://iportal2.schneider-electric.com/Contents/docs/SQD-LC1D80BD.PDF), redirected to https://iportal.se.com/Contents/docs/SQD-LC1D80BD.PDF. Saved as `references/lc1d80bd.pdf`,.

Manufacturer spelling is **LC1D80BD**. The source's **LC1-D80BD** is treated as a presentation-hyphen spelling: the remaining exact code and all historical descriptive attributes match the exact sheet. The requested order spelling and type ID are preserved; no successor is substituted.

Page 1 confirms three NO main poles, one NO plus one NC auxiliary, and a 24 V DC standard coil. Page 3 explicitly excludes a built-in suppressor. No conflict with the historical description was found.

## Diagram and independent inventory

Visually reviewed the full exact-product wiring page 6 at 150 DPI, then its diagram at 600 DPI, crop rectangle `(40,160,150,230)` PDF points. Both images and provenance sidecars are retained locally.

| Function     | Manufacturer diagram marks | Normal state |
| ------------ | -------------------------- | ------------ |
| Coil         | A1, A2                     | DC coil      |
| Main pole 1  | 1/L1, 2/T1                 | Open         |
| Main pole 2  | 3/L2, 4/T2                 | Open         |
| Main pole 3  | 5/L3, 6/T3                 | Open         |
| Auxiliary NO | 13/NO, 14                  | Open         |
| Auxiliary NC | 21/NC, 22                  | Closed       |

These are the 12 documented electrical endpoints. Slash markings are retained literally. The common actuation line is mechanical; neither it, the coil, nor the NC contact establishes a permanent net join. **Factory fixed links: none shown.** No PE, shield or communication endpoint is documented. This diagram omits coil polarity signs; the manufacturer instruction A1 positive / A2 negative is established by the additional FAQ cited below.

## Ratings and modeling scope

S1 pp. 1–3: AC-3 80 A and AC-1 125 A at no more than 440 V AC, ambient no more than 60 °C; 37 kW at 380–400 V AC, 50/60 Hz, AC-3. Coil consumption is 22 W at 20 °C. These conditional contact ratings remain notes, not scalar nominal-voltage/current assignments. The sheet's anomalous DC voltage/frequency text is not modeled.

All six functions map to existing coil/contact symbols. A1/A2 are required for coil operation; passive contact use is application-dependent. Page 2 specifies power connectors and control screw clamps, including two-conductor capacities; it does not establish duplicate coil-access positions or their factory links. Accordingly, the model covers the complete published circuit but claims **partial** physical inventory. Optional accessories are excluded. Exact physical duplicate-access evidence remains unresolved.

Search record: exact-code manufacturer search yielded S1, including its own wiring page, so neighboring variants were unnecessary. The suggested B8 catalog URL was attempted through the web tool but exceeded its size limit; it is not supporting evidence. Central verification is left to the coordinator.

## Coordinator polarity evidence

The exact simplified circuit diagram omits polarity signs, but the directly reviewed [Schneider FAQ FA121938](https://www.se.com/us/en/faqs/FA121938/) explicitly instructs A1 positive and A2 negative for LC1D***D DC coils. The model now records that manufacturer instruction. Absence of a built-in suppressor does not establish non-polar wiring. Original worker files remain unchanged.
