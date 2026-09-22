# gvae20 — Schneider Electric GVAE20

## Assignment

Single source identity `GVAE20` (Schneider), catalogued as an auxiliary contact
block (2 NO) for GV2 protection switches, front mounting. Target type id
`schneider-pilot:gvae20`. The catalogue description is historical evidence, not
a specification.

## Identity — confirmed

Schneider Electric **GVAE20**, TeSys (Deca / GV range) **instantaneous auxiliary
contact block**, **front mounting**, contact composition **2 N.O.**, for GV2 or
GV3P motor-protection circuit breakers. This is the exact order code, not a
successor or abbreviation.

- Schneider catalog 0100CT1501 (Digest 178), Section 18, Table 18.134
  "Auxiliary Contact Blocks", p.36: row `GVAE20` = _Instantaneous auxiliary
  contacts GV2 or GV3P_, Mounting **Front**, Contact Type **N.O. + N.O.**, sold
  in lots of 1. Footnote [44]: "For spring terminals, add 3 to the catalog
  number (e.g. GVAE113)" — so bare **GVAE20 = screw terminals** (GVAE203 would
  be the spring variant). Hosted on Schneider's own portal (iportal.se.com).
- Schneider Product data sheet **GVAE20** (Sep 16, 2022): "Auxiliary contact
  block, TeSys Deca, 2NO, front mounting, for GV2"; Pole contact composition
  **2 NO**; compatibility GV2L, GV3P, GV2ME, LS1D32, GV3L, GV2RT, GV2P, GV2LE.

Note: footnote [43]'s reversible N.O./N.C. choice applies to the single
`GVAE1` block, **not** to GVAE20, which is fixed 2 N.O.

## Terminal inventory — from the connection diagram (visually inspected)

Datasheet p.3 "Connections and Schema" renders the GVAE20 as two independent
**normally-open** contacts, both drawn from a shared (dashed) mechanical
actuator link:

| Function | Contact | Terminals   |
| -------- | ------- | ----------- |
| no1      | N.O.    | **13 – 14** |
| no2      | N.O.    | **23 – 24** |

Markings read directly from a 600-DPI crop of the diagram
(`references/gvae20-datasheet-page-3-clip-40_150_130_230-600dpi.png`). Both
symbols are the open form; the dashed cross-link between the two contact levers
indicates a single common actuator (the block follows the host breaker's
position), i.e. the two contacts are mechanically ganged. This numbering is
standard IEC 60947-5-1 for two instantaneous N.O. auxiliary contacts (function
digits 3/4 = N.O.; group digits 1 and 2). Four electrical terminals total; there
is **no** PE/bond terminal and no coil.

## Ratings (datasheet p.1) — kept as notes, not scalar terminal ratings

The contacts are AC/DC universal-range switching points, so no single
`rating.nominal_voltage` is assigned to a terminal (a range maximum is a
capability, not a circuit intent; the block is rated for both AC and DC).

- [Ith] conventional free-air thermal current: **2.5 A**
- [Ui] rated insulation voltage: **300 V** (UL 508 / CSA C22.2 No.14), **250 V**
  (IEC 60947-1)
- [Ue] rated operational voltage: **24…240 V AC**, **24…60 V DC**
- Minimum switching: **5 mA**, **17 V**
- AC-15 rated operational power: 120 VA @110–120 V, 120 VA @230–240 V,
  48 VA @24 V, 60 VA @48 V (electrical durability 100 000 cycles)
- DC-13 rated operational power: 24 W @24 V, 15 W @48 V, 9 W @60 V
- Terminals: **screw clamp**, tightening torque **1.4 N·m**
- Dimensions 11 (H) × 45 (W) × 29 (D) mm; ~0.02 kg; mechanical durability
  100 000 cycles

## Modeling decisions

- `decision: candidate`. Identity, contact composition and terminal markings are
  established from Schneider-authored documents, including a visually inspected
  connection diagram.
- Two independent N.O. contact functions (`no1` 13-14, `no2` 23-24), circuit
  symbol `contact-no` each; render as a `circuit`.
- `internal_relations`: `ganged_with` no1↔no2 (single common actuator shown by
  the dashed linkage). This is a mechanical statement only; it creates no
  electrical continuity.
- No terminal is universally required: passive signalling contacts are
  application-dependent. `requiredTerminalKeys: []`.
- No `fixedLinks`: switched contacts never permanently join nets; no jumper,
  coil, supply, return, shield, comms or PE is present on this block.
- `connectionCoverage: complete` for the electrical interface (all four contact
  terminals documented). The coupling to the host GV2/GV3P is mechanical only,
  is not an electrical terminal, and the host device is outside this block's
  type; no enclosure/panel bonding is asserted.

## Sources

1. Schneider Electric catalog **0100CT1501** (Digest 178), Section 18, p.36,
   Table 18.134 — hosted at iportal.se.com (manufacturer). Downloaded copy:
   `references/section18.pdf` , text in
   `references/section18.txt`.
2. Schneider Electric **Product data sheet GVAE20**, Sep 16, 2022 — obtained
   from the Automation24 datasheet mirror (manufacturer-mirror; Schneider-
   authored export). Copy: `references/gvae20-datasheet.pdf`
   . Diagram crop inspected at 600 DPI.

## Unresolved / notes for a follow-up researcher

- The primary Schneider-hosted copy of the individual GVAE20 datasheet
  (`download.schneider-electric.com/files?p_Doc_Ref=GVAE20_document…`) returned
  HTTP 403 to the fetch tool; the identical content was obtained from the
  Automation24 mirror and cross-checked against the se.com-hosted catalog.
- Packaging discrepancy (electrically irrelevant): the catalog lists GVAE20
  "sold in lots of 1", while the datasheet's "Quantity per set" reads "Set of
  10" and packaging shows PCE=1 / BB1=10. This is a packaging/ordering detail,
  not a contact-count question; the block itself is 2 N.O.
