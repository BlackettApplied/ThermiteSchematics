# lad-n40 — Schneider LADN40 (job code "LAD-N40")

## Decision

**candidate.** Identity and the complete electrical connection inventory are
established from the manufacturer's own TeSys catalogue chapter B8, including a
visual inspection of the exact LADN40 contact scheme.

## Identity

- **Manufacturer:** Schneider Electric.
- **Order number (manufacturer spelling):** `LADN40` — no separator. The source
  / job code `LAD-N40` inserts a presentation hyphen; `LAD N40` is another
  spacing variant. Same reference, not a successor substitution.
- **What it is:** TeSys D / TeSys D Green **front-mounting add-on _instantaneous_
  auxiliary contact block**, clip-on, composition **4 N/O**, screw-clamp
  terminals (base reference). Fits LC1-D (and TeSys D Green) contactors.

## Primary evidence (Schneider B8 catalogue, downloaded to `references/b8.pdf`)

Source URL: https://iportal2.schneider-electric.com/Contents/docs/B8_CONTACTORS_EN_CATALOGUE.PDF
(resolved to iportal.se.com; Schneider Electric official). 126 pages,
.

1. **Selection table — catalogue p.B8/22 (physical PDF p.22).** Row
   "Front / clip-on / 4 contacts per block / 4 N/O / **LADN40**", under the
   heading _"Instantaneous auxiliary contact blocks for connection by screw
   clamp terminals."_ The suffix rules on the same page show base LADN40 =
   screw clamp; **+3** = spring terminals (LADN403), **+6** = lug/Faston
   (LADN406) — those are different references and are not modeled here.

2. **Contact scheme — catalogue p.B8/79 (physical PDF p.79), figure 127275.eps.**
   Rendered and **visually inspected** (`references/b8-page-79-clip-430_425_595_575-500dpi.png`).
   The LADN40 diagram shows **four independent normally-open contacts** with
   terminal marks:
   - 53 – 54 (N/O)
   - 63 – 64 (N/O)
   - 73 – 74 (N/O)
   - 83 – 84 (N/O)

EN 50005 numbering: units digit 3/4 = N/O; tens digit 5/6/7/8 = contact
position. **No N/C contacts.** (The neighbouring LADN20 shows 53-54/63-64 and
LADN31 shows 53-54/61-62/73-74/83-84, confirming the diagrams are per-variant
and that LADN40's own row is 53/63/73/83.)

3. **Characteristics — catalogue p.B8/66 (physical PDF p.66)** for the add-on
   instantaneous auxiliary contact blocks (References: p.B8/22):
   - Rated operational voltage Ue ≤ **690 V**
   - Rated insulation voltage Ui **690 V** (IEC 60947-5-1); **600 V** UL/CSA
   - Conventional thermal current Ith **10 A** at ambient ≤ 60 °C
   - Frequency 25…400 Hz; min switching capacity 17 V / 5 mA
   - Short-circuit protection: gG fuse **10 A**
   - AC-15 and DC-13 operational currents are **conditional per voltage**
     (tables on p.B8/68) — not flattened to a scalar here.
   - Screw-clamp cabling 1×1 … 2×2.5 mm², torque 1.7 N·m.

## Modeling

- Eight terminals: `53 54 63 64 73 74 83 84`, all role _control_,
  `connection_policy: shared`.
- Four `contact` functions, each `normal_state: open`, `circuitSymbols:
contact-no`. `renderKind: circuit`.
- **No fixed links.** The four contacts are galvanically separate. The host
  contactor's actuator mechanically **gangs** all four (they operate together),
  but that coupling is mechanical/functional and does **not** join the contact
  nets; there is no factory jumper between any of the eight terminals.
- The block has **no** coil, supply, return, PE/bond, shield or communication
  connection of its own. The clip-on interface to the contactor is non-electrical.
- **No scalar terminal rating asserted.** Ue/Ui/Ith and the AC-15/DC-13 tables
  are capabilities kept in notes; `rating.nominal_voltage` is intentionally
  unset so the compiler does not read a capability as an assigned circuit voltage.
- Contacts are passive and application-dependent → none is universally required
  (`requiredTerminalKeys` empty).

## Connection coverage

**complete** — all eight terminals of the four N/O contacts are documented from
the exact LADN40 scheme; the accessory exposes no other electrical interface.

## Unresolved / notes for a later reviewer

- Exact terminal technology of _this_ installed unit (base screw-clamp vs a
  `…3` spring or `…6` lug variant) is assumed to be the base screw-clamp LADN40
  per the source code; the job code carries no `3`/`6` suffix.
- Precise B8 catalogue edition/date is not printed on the extracted pages
  (chapter identifier only); document retrieved 2026-09-11.
- AC-15/DC-13 per-voltage operational currents (p.B8/68) not transcribed in full;
  only the headline capability values are recorded above.

## Coordinator review

Confirmed B8/22 exact row and B8/79 four-NO diagram. Added the documented common mechanical actuation to internal_relations; no conductive links. Manufacturer punctuation is recorded in notes rather than unsupported type alias metadata.
