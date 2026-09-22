# lad-4vu — Schneider LAD-4VU / LAD4VU

Decision: **candidate**, with partial physical terminal coverage. This follow-up
corrects the completed author's zero-terminal accessory classification. The
original job, type, result, research and acquisition record remain unchanged in
`lad-4vu`. The source spelling `LAD-4VU` and required type ID
`schneider-pilot:lad-4vu` are preserved; the manufacturer's exact order is
**LAD4VU**. No successor is substituted.

## Exact identity and applicable installation evidence

- **S1:** [Schneider TeSys contactors, Chapter B8](https://iportal2.schneider-electric.com/Contents/docs/B8_CONTACTORS_EN_CATALOGUE.PDF),
  physical p24 / printed B8/24, exact LAD4VU row: varistor, 110–250 V AC, side clip
  mounting for D09–D38 / DT20–DT40. Notes (1), (3) and (5) establish installation
  across the coil, electrical contact by clipping, and removal of an existing
  suppressor before fitting. Printed edition/date was not established.
- **S2:** [Exact LAD4VU datasheet](https://iportal2.schneider-electric.com/Contents/docs/SQD-LAD4VU_DATA%20SHEET.PDF),
  **19 Mar 2019**, p1: 110–250 V AC, 50/60 Hz; side mounting by clips; maximum
  peak 2 Uc. Compatibility includes LC1D09–D38, LC1DT20–DT40, LC1D098–D258 and
  CAD32/CAD50. This opened official PDF replaces reliance on search snippets for
  the CAD compatibility claim. Its photograph visibly shows **LAD4RC3E**, so that
  photograph is not LAD4VU physical-label evidence.
- **S3:** [Schneider LC2DT••3•• instruction sheet, manufacturer-authored RSP mirror](https://rspsupply.com/images/downloads/Schneider/L/Schneider%20LAD4VU/Schneider%20LAD4VU%20Instruction%20Sheet.pdf),
  **W9 1380874 01 21 A04, 06/2016**, p1: the applicable LAD4V AC figure shows a
  side-attachment module with two attachment ends and a two-terminal varistor
  schematic. Exact applicability comes from the S1/S2 selection and compatibility
  evidence; the installation figure itself is family-labelled LAD4V.

These pages and enlarged figures were independently rendered and visually
inspected. PDF bytes, SHA-256 values, page images and crops are retained under
`../../reviewer-0345/references/`; `instruction-ac-lad4v-attachment.png` is the
decisive installation crop. B8/80 was also inspected but has no exact LAD4VU
schematic and is not used to assign terminals.

## Connection and function model

The absence of separate field-wire screws does not remove the two electrical
clip contacts. The model explicitly contains:

| Alias | Meaning                                                           | Required |
| ----- | ----------------------------------------------------------------- | -------- |
| S1    | First logical varistor attachment end, to one host-coil net       | Yes      |
| S2    | Other logical varistor attachment end, to the other host-coil net | Yes      |

**S1/S2 are library aliases**, not stamped labels, polarity or physical
top/bottom assignments. The opened drawings do not establish exact slot-to-A1/A2
mapping. Required status is an explicit library policy for this model of an
installed suppressor: both attachment ends must be present for the modeled use.
It does not establish mechanical seating, host compatibility or correct coil-net
selection. Host field wiring still lands on the host terminals; the abstract
attachment connections are not additional field-wire screws.

`VARISTOR` uses the existing two-terminal `load` function and `load` symbol,
identified as a varistor in its name and description. This is a generic circuit
representation; it does not reproduce the dedicated manufacturer varistor glyph
or simulate nonlinear conduction, clamping, surge energy, protective adequacy or
contactor timing. It is neither a coil nor a switching contact. **No fixed links
exist in the authored model**: the suppressor does not permanently merge the two
coil nets. Attachment to a host is not automatic.

Coverage is **partial** for unresolved physical contact labels, orientation and
fine connector geometry. The two electrically distinct attachment ends are
represented. No PE, shield, communication, separate supply or host power poles
are shown as part of this accessory in the inspected evidence.

## Ratings and source discrepancies

The source says **110–240 V AC**. S1/S2 specify **110–250 V AC**; an exact-code
[Schneider regional product title](https://www.se.com/pe/es/product/LAD4VU/m%C3%B3dulo-supresor-tesys-d-varistor-110240-vac/)
also retains 110–240 V AC. Preserve both descriptions. No capability `nominal_voltage`, scalar current, or invented DC rating
is assigned. The family-wide AC/DC envelope on B8/69 does not grant the exact
LAD4VU a DC rating.

S1 reports a maximum transient of 2 Uc and a contactor drop-out multiplier of
1.1–1.5. The inspected sources do not establish absolute clamp voltage or surge
current/energy values. These remain notes, not simulated characteristics.

S1 and S2 support side mounting. The current
[Clipsal LAD4VU page](https://www.clipsal.com/products/industrial/tesys/suppressor-module-varistor-110-250-v-ac-lad4vu?itemno=LAD4VU)
says side in its description but front in a data field. This candidate is bounded
to the independently documented side-mounted arrangement. B8/24 note (4), which
mentions top mounting on A1/A2, applies to screw-fixing variants and does not prove
LAD4VU has physical A1/A2 labels.

## Preserved acquisition history and review limits

The original worker reported its Bash research-helper calls were blocked and used
the supplied B8 PDF plus indexed manufacturer text; it left the exact catalogue
date unresolved. That record is preserved in the original research and worker
outputs. The independent reviewer used the shared manufacturer B8 PDF, downloaded
S2/S3 with normal TLS, and inspected actual page images.
