# zb4-bw0b35 — Schneider Electric ZB4-BW0B35

Decision: **candidate, partial physical connection coverage**. Exact manufacturer
reference `ZB4BW0B35` is the source's `ZB4-BW0B35`: a Harmony XB4 body/fixing collar,
one NO and one NC contact, and a green integral LED with direct 24 V AC/DC supply.
The operator head is separately selected. This review models only that factory
assembly, using six illustrated field terminals.

## Identity and included components

The [exact November 11, 2015 manufacturer sheet](https://iportal.se.com/Contents/docs/SQD-ZB4BW0B35.PDF),
p.1, confirms a complete body/contact/light assembly, Zamak fixing collar, green
protected integral LED, direct 24 V AC/DC 50/60 Hz, and one NO plus one NC slow-break
contact. The [10/2021 Harmony XB4 catalog](https://iportal.se.com/Contents/docs/HARMONY%20XB4%20METAL%20CONTROL%20AND%20SIGNALING%20UNITS_CATALOG.PDF),
physical p.86 / printed p.84, independently identifies the exact green 24 V
one-NO/one-NC screw-clamp row. Additional contact blocks are optional.

Catalog physical p.32 / printed p.30 shows complete pushbutton `XB4BW33B5` as
`ZB4BW0B35` plus head `ZB4BW333`. Physical p.60 / printed p.58 also combines this
same body with two- and three-position selector heads. These examples establish
head exclusion and head-dependent operation; they do not replace this order with
a complete pushbutton or selector.

The constituent functions are established, but the opened sources do not provide
a complete itemized service-parts bill of materials. A side image marks `ZBE-101`;
that does not establish every internal SKU. In particular, the historical sheet's
p.1 generic image visibly marks a white `ZBV-B1` lamp; it is not proof of the
green assembly's exact lamp-module SKU.

The source describes a green 24 Vac/dc LED assembly and fastening clamp, one NO
and one NC. Its 19 occurrence records are source associations, not independently
verified installed counts or head configurations.

## Field-terminal evidence and numbering difference

The [direct exact-order manufacturer sheet](https://www.se.com/au/en/product/download-pdf/ZB4BW0B35),
printed September 12, 2026, was downloaded and its illustrations inspected. Page
7 shows the NO block's printed 3–4 circuit. Page 8 shows six rear screw terminals:

| Modeled keys | Illustrated function | Normal condition                            |
| ------------ | -------------------- | ------------------------------------------- |
| `1`, `2`     | NC contact           | Closed with this block's plunger unoperated |
| `3`, `4`     | NO contact           | Open with this block's plunger unoperated   |
| `X1`, `X2`   | Green LED supply     | Independent direct 24 V AC/DC supply        |

These are manufacturer-assigned alternate/family images on the exact-order
sheet. The associated product-page asset names include B55/B65/G35 references.
They document the illustrated constituent-block interface, while the exact B35
catalog row independently establishes its electrical composition and green lamp
rating. They are not an inspected as-built B35 specimen.

The exact historical and current sheets' separate ISO terminal-description field
says **NC (11–12)**. That published difference is preserved. This candidate uses
the physical illustration's `1/2`, does not add another NC pair, does not silently
alias ISO `11/12`, and does not infer NO `13/14` from generic IEC convention.
Actual installed markings require reconciliation before installation use.

No fixed internal links are authored. The NC contact, NO contact and lamp are
three independent two-terminal functions; neither contact metadata nor the lamp
load is a permanent short. Mechanical clips do not create electrical continuity.

## Supply, operation and requirements

The [exact May 9, 2023 Schneider sheet, RS mirror](https://docs.rs-online.com/395d/0900766b81698eb0.pdf),
pp.1–2, confirms functional lamp supply 24 V AC/DC, 50/60 Hz; limits 19.2–30 V DC
and 21.6–26.4 V AC; steady green illumination and 18 mA consumption. No AC-only or
DC-only scalar is assigned.

[Schneider FAQ FA319072](https://www.se.com/us/en/faqs/FA319072/), published June
27, 2017 and modified September 1, 2026, recommends DC positive on `X1`, negative
on `X2` for consistency. Its statement about polarity insensitivity is qualified
as applying to most ZBV units. This supports a recommended connection convention,
not exact B35 proof of arbitrary DC polarity or a hard polarity-sensitive input.

The head/cam and contact position determine which independent plungers operate.
There is no universal simultaneous gang, momentary return or maintained action
intrinsic to this headless body, and no automatic lamp/contact operation relation.
The sheet's NC and NO state-change travels, respectively 1.5 and 2.6 mm, also do
not justify claiming identical transition timing. Generic NO/NC contact symbols
represent the bounded functions without imposing a pushbutton head.

Contacts remain application-dependent and optional. Requiring `X1` and `X2` is
explicit library policy for a functioning modeled lamp, not a manufacturer claim
that the lamp must be energized in every application.

## Bonding and physical access

The exact sheet identifies a Zamak collar and Class I construction.
[Schneider mounting FAQ FA284040](https://www.se.com/us/en/faqs/FA284040/), published
April 11, 2016 and modified August 21, 2026, calls the collar fixing screw the
grounding screw in step 3. Exact-product-linked [instruction 155997103A55](https://download.se.com/files?p_Doc_Ref=155997103A55),
W915599710311A08, 01/2011, p.1, depicts collar fixing and mechanical contact-block
attachment.

This is a known grounding/mounting provision. The opened evidence does not
enumerate a separately labeled PE field terminal or its conductor inventory.
The model therefore retains **partial physical/bonding coverage**: no invented
PE terminal, no automatic panel/head bond, and no assertion that the assembly
lacks a bonding provision. The separately selected head, optional added blocks
and interfaces exposed only by disassembly are outside the bounded factory
assembly model.

## Conditional ratings

The exact 2023 sheet pp.1–2 gives contact Ith 10 A, Ui 600 V at pollution degree 3
and Uimp 6 kV. AC-15 ratings are 6 A at 120 V, 3 A at 240 V and 1.2 A at 600 V;
DC-13 ratings are 0.55 A at 125 V, 0.27 A at 250 V and 0.1 A at 600 V. These remain
capability notes, not assigned operating scalars. Positive-opening qualification
under EN/IEC 60947-5-1 Appendix K and specified 10 A gG short-circuit protection
do not establish safety of an arbitrary fitted head or circuit.

Clamp torque is 0.8–1.2 N·m. Conductor statements retain count and preparation
conditions: at least one 0.22 mm² conductor without end sleeve; at most two
1.5 mm² conductors with end sleeves. They are not converted to an unqualified
continuous wire range.

## Review and acquisition provenance

The original worker completed before this followup was created. Its job/schema
are copied byte-identically, and its type/result/research remain immutable.
Original hashes and final followup hashes are retained in `reviewer-0402`.
The original author opened the 2015 sheet and 2021 catalog, and reported
unavailable distributor diagrams. This review preserves that acquisition history
while replacing convention-derived terminal guesses with the subsequently opened
manufacturer illustrations. The original automatic panel-bond claim is removed.

Reviewer evidence is saved under `reviewer-0402/references`, including catalog
pages 32/60/86, exact sheet pages 7/8/9, the enlarged rear-label image, historical
sheet p.1 and the mounting instruction. Additional exact 2024 data, dimensional
sales drawing and CAD ZIP were inspected as evidence avenues; they did not supply
a consolidated terminal scheme or full internal SKU bill of materials. Source
URLs and downloaded-byte hashes are indexed in `reviewer-0402/sources.json`.

Strict JSON, byte preservation and formatting are checked locally. Central
verification, canonical integration and full tests are reserved for the
coordinator.
