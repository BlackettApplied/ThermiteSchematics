# zb4-bd2 — Schneider ZB4-BD2

Decision: **candidate**, limited to the mechanical selector head; connection coverage **partial**.

## Identity and scope

The proposed identity is `schneider-pilot:zb4-bd2`, manufacturer `Schneider Electric`, order `ZB4-BD2`, preserving the job spelling. Schneider publishes **ZB4BD2**. The match treats the separator after ZB4 as historical presentation punctuation: the remaining full code and the source's black standard/short handle, two maintained positions and 90° travel agree. No suffix is added or removed. This punctuation equivalence is a research inference, not an explicit manufacturer cross-reference; a targeted `site:se.com "ZB4-BD2"` search returned no results.

The source's “0-1” is functional position notation, not proof of supplied legends. Schneider's exact product page describes the head as unmarked. Do not model printed 0/1 markings or import a contact assembly from the historical device designation.

## Opened evidence

- **S1 — [Product data sheet: ZB4BD2, black selector switch head Ø22 2-position stay put](https://iportal2.schneider-electric.com/Contents/docs/SQD-ZB4BD2.PDF)**, Schneider Electric, 15 August 2018, 17 pages. Download redirects to `https://iportal.se.com/Contents/docs/SQD-ZB4BD2.PDF`; saved as `references/zb4bd2.pdf` with extracted text. Page 1 identifies a chromium-plated metal bezel, black standard handle, 22 mm mounting and two maintained positions 90° apart. Visually inspected p.3 dimension drawing and p.17 fitted-contact sequence diagram. The latter describes operation of contacts fitted to a body, not contacts supplied in this head. Page 1 also lists composition options and Class I per IEC 60536 (under the sheet's “Overvoltage category” field). That classification does not identify a bonding terminal or path.
- **S2 — [Control and signaling units, Harmony XB4 metal](https://iportal.se.com/Contents/docs/HARMONY%20XB4%20METAL%20CONTROL%20AND%20SIGNALING%20UNITS_CATALOG.PDF)**, Schneider Electric, October 2021, DIA5ED2121212EN V13.0. Read supplied local original `references/schneider-xb4-2021.pdf`; confirmed revision on final page. Visually inspected printed p.54 / PDF p.56: exact ZB4BD2 row under “Heads only,” black standard handle, two maintained positions at 90°. Its corresponding position glyph was inspected. Complete-unit rows explicitly combine this head with a separate body/contact assembly. The nearby photograph is labelled ZB4BD4 and was not used as exact-part evidence. Web opening of the catalog URL failed; the supplied original was readable locally.
- **S3 — [Schneider Electric USA ZB4BD2 product page](https://www.se.com/us/en/product/ZB4BD2/harmony-22mm-push-button-selector-switch-operating-head-2-position-maintained-black-unmarked/)**, undated, accessed 12 September 2026. Opened exact product heading confirms maintained black unmarked operating head. Generic connection-method marketing does not establish head terminals.

## Independent connection inventory and model boundary

Zero documented power, return, signal, communication, shield or PE terminal markings belong to the head. No electrical block is included in this head-only order. No fixed electrical link is established. These conclusions come from the exact head-only selection and product scope, not from an empty model.

The metal head's attachment/bonding interface remains unspecified in the reviewed evidence. Consequently an empty terminal inventory is **not** a claim of exhaustive electrical isolation or an installed panel bond. Further manufacturer installation/bonding evidence is needed before complete coverage can be claimed.

Use empty terminals/functions and an accessory documentation view. No supported circuit symbol is needed for this mechanical-only scope. Do not model optional block contacts, switching continuity or electrical ratings. Mechanical/environmental specifications do not establish nominal circuit voltage or switching current. No bespoke fixture, tests, installation or shared-library changes were performed; central verification is deferred to the coordinator.
