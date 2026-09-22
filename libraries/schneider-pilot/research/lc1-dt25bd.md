# lc1-dt25bd — Schneider Electric LC1-DT25BD

Decision: **candidate with partial physical connection coverage**. Exact
manufacturer LC1DT25BD establishes four NO main poles, factory 1NO + 1NC auxiliary
and standard 24 VDC coil. Fourteen field screw terminals are established. The
coil is **A1 positive / A2 negative**; bidirectional suppression does not establish
arbitrary polarity. The removable suppressor's individual mating ends remain
unmodeled.

## Identity and exact sources

The source order `LC1-DT25BD` is preserved, including its presentation hyphen. The manufacturer exact order is `LC1DT25BD`; no successor is substituted.

1. [Schneider LC1DT25BD product data sheet](https://media.distributordatasolutions.com/schneider2/2021q1/documents/b165d75dfebec0749c763a5a247400882d0e1c38.pdf),
   January 13, 2021, manufacturer-authored distributor mirror, five physical pages.
   Pages 1–3 establish the exact order and ratings. Pages 2–3 were rendered and
   visually inspected; the product photo is corroboration, not sole pinout proof.
2. [Schneider B8 contactor catalogue](https://iportal2.schneider-electric.com/Contents/docs/B8_CONTACTORS_EN_CATALOGUE.PDF),
   126 pages, no printed edition date identified on inspected pages..
   Physical pages and printed B8 page numbers coincide. B8/12 exact LC1DT25 row
   and BD coil-code column, B8/79 four-pole scheme 127267.eps, and B8/24
   suppression table/footnotes were visually inspected.
3. [Schneider screw-clamp instruction 1378323_01A55](https://download.se.com/files?p_Doc_Ref=1378323_01A55),
   two pages, printed **W9 1378323 0211 A14, 02/2021**; the page-1 inset retains
   A11. Page 1 explicitly includes LC1DT25 in the terminal table, labels A1+
   and A2− in the assembly drawing, and depicts removable DC suppression.
   This document is directly linked by the installation-instruction download on
   the [exact manufacturer's LC1DT25BD page](https://www.clipsal.com/products/industrial/tesys/contactor-tesys-deca-4p4-no-ac-1-0-to-440v-25a-24vdc-standard-coil-lc1dt25bd?itemno=LC1DT25BD).
   Its live download-list date is later than the printed PDF date and is not
   treated as the drawing revision. The instruction's lower circuit diagram has
   three main poles; the applicable four-pole topology comes from B8/79.
4. [Schneider FAQ FA121938](https://www.se.com/ca/en/faqs/FA121938/),
   published August 28, 2007, last modified May 12, 2026. For LC1D***D DC coils,
   Schneider assigns positive to A1 and negative to A2 and confirms the device
   carries polarity marks. This corroborates the applicable instruction.

B8/12 gives LC1DT25 with four NO main poles and factory 1NO/1NC auxiliary;
BD is the 24 VDC standard-coil code for LC1DT20–DT40. The adjacent LC1D128
2NO/2NC main-pole row and low-consumption BL coil are different variants.

## Field inventory and topology

| Function          | Terminal keys | Manufacturer markings and state    |
| ----------------- | ------------- | ---------------------------------- |
| Main pole 1       | 1/L1, 2/T1    | NO                                 |
| Main pole 2       | 3/L2, 4/T2    | NO                                 |
| Main pole 3       | 5/L3, 6/T3    | NO                                 |
| Main pole 4       | 7/L4, 8/T4    | NO                                 |
| Factory auxiliary | 13, 14        | 13/NO–14, NO                       |
| Factory auxiliary | 21, 22        | 21/NC–22, NC                       |
| Coil              | A1, A2        | A1+ positive; A2− negative; 24 VDC |

B8/79 scheme 127267.eps, explicitly covering LC1DT20–DT80A and referring back
to B8/12–13, establishes the four main pairs and auxiliary pairs with common
coil actuation. Six `actuates` relations represent that mechanism. No permanent
links are created through moving contacts, coil or suppressor. Contact normal
states, mirror qualification and mechanical relations do not join physical nets.

`A1+`, `A2−`, `13/NO` and `21/NC` are documented polarity/function aliases of
existing keys, not additional terminals. The schema has no dedicated polarity
or alias field, so descriptions carry these facts; they do not provide an
automatic reverse-polarity diagnostic.

Required A1/A2 is **explicit library policy for the modeled operating contactor**,
not a universal manufacturer requirement for an unused or stored device. Main
and auxiliary terminals are optional because their use is application-dependent.
Shared connection policy does not enforce the manufacturer's conductor-count
limit. No PE, shield or communication terminal is identified in the applicable
field diagram; no bonding is inferred from rail or plate mounting.

## Suppression and partial coverage

The exact sheet page 3 confirms built-in bidirectional peak-limiting suppression.
B8/24 footnotes explicitly include LC1DT20–DT40 DC, state that the standard
suppressor is removable/replaceable, and identify clipping as the electrical
connection. Its table lists LAD4TBDL for 24 VDC; LAD9DL is the blanking alternative
if this range is used without suppression. Instruction page 1 shows the DC
suppression and blanking arrangements.

The two unnumbered accessory mating ends are outside this field-terminal model:
individual labels, orientation and bindings are not established here. Overall
coverage is therefore **partial**, despite the established fourteen field screws.
Optional coil adapters, auxiliary/timer/latch add-ons and their terminals are
excluded. The installed suppressor/accessory state was not inspected.

## Ratings and limitations

The exact sheet pages 2–3 establishes:

- AC-1 25 A at ≤440 VAC and its printed ambient condition of <60 °C; B8/12 uses
  θ ≤60 °C. Power Ith is 25 A and signalling Ith is 10 A at 60 °C. These are
  conditional notes, not universal scalar current limits.
- Power capability ≤690 VAC at 25–400 Hz or ≤300 VDC. No capability
  `nominal_voltage` or AC-only constraint is applied to switched terminals.
  The BD coil genuinely has nominal supply 24 VDC.
- Coil inrush and holding 5.4 W at 20 °C; operation 0.7–1.25 Uc at −40 to 60 °C
  and 1–1.25 Uc at 60 to 70 °C; dropout 0.1–0.25 Uc at −40 to 70 °C.
  B8/12 selection prints 0.75–1.25 Uc, while B8/62 characteristics gives a 0.7
  lower factor at 60 °C. The published difference is retained without an
  invented explanation or simulated threshold.
- Power/control screw-clamp torque 1.7 N·m. One or two solid/unferruled flexible
  conductors: 1–4 mm²; one ferruled flexible: 1–4 mm²; two ferruled flexible:
  1–2.5 mm². These wire preparation/count conditions stay in notes.
- Factory 1NO/1NC contacts are mechanically linked; the NC has the specified
  mirror-contact qualification. Minimum signalling load is 17 V/5 mA. No timing,
  safety certification or full duty/coordination model is implied.

The source quantity 13 is a printed sum, not a verified installed count.

## Acquisition and independent comparison

The completed original worker files remain immutable in
`lc1-dt25bd`. Their B8 acquisition and visual scheme evidence are retained
as provenance; this followup corrects the unsupported inference that bidirectional
suppression means unspecified coil polarity, and the claim of complete physical
coverage. It also replaces “universally required” wording with explicit library
policy and retains conditional ratings in notes.

Independent reference PDFs, rendered pages/crops, SHA-256 records and the
comparison are under `reviewer-0363`. The earlier 03/2017 LC1D instruction from
reviewer-0357 was inspected as historical corroboration; final polarity evidence
uses the directly applicable manufacturer instruction linked by this exact part.
The final candidate was formatted and checked for strict JSON; central electrical
verification and promotion remain the coordinator's responsibility.
