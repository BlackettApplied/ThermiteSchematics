# zb4-bj3 — Schneider Electric ZB4BJ3

## Decision

**candidate** — a zero‑electrical‑terminal mechanical actuator head.

Identity and mechanical/electrical scope are fully established from primary
manufacturer evidence. ZB4BJ3 is the **operator head only**; it carries no
contact block, no lamp, and no electrical terminals. Contacts belong to a
separately ordered body/fixing collar. This is a complete determination, not a
gap, so the result is a candidate with an explicit zero‑terminal inventory
rather than needs‑evidence.

## Primary evidence

1. **Schneider Electric — Harmony XB4 metal, Control & signaling units catalog,
   10/2021** (`references/schneider-xb4-2021.pdf`, official iportal.se.com copy).
   - PDF **page 57** (catalog p.55), _"Selector switches with long handle"_.
     Rendered and visually inspected (`references/schneider-xb4-2021-page-57.png`).
   - Under **"Heads only"**: _Long handle, black — 3‑position ±45° — Stay put —
     `ZB4BJ3`_, weight 0.040/0.088 kg/lb. The NO/NC contact columns are **blank**
     for the heads-only rows; they are populated only for the _Complete units_.
   - _Complete units_ row: `XB4BJ33 = (ZB4BZ103 + ZB4BJ3)` = body/fixing collar
     with **2 NO** + the ZB4BJ3 head. So the contacts live in the ZB4BZ103 body,
     not in ZB4BJ3.
   - Footnote (1): _"For recommended maximum number of contacts and sequence of
     contacts constituting the body (fixing collar + contact) associated with the
     head, see page 24."_ — confirms contacts are a separate body/collar order.
2. **Schneider Electric product page ZB4BJ3** (se.com, accessed 2026‑09‑12):
   _"Head for selector switch, Harmony XB4, metal, black, 22mm, long handle,
   3 positions, stay put."_ States **operator head only, no contact blocks
   included**; _"A wide choice of contact blocks"_ is available separately;
   3 positions at **±45°**; stay‑put (maintained); black; long handle; Ø22.

## Identity mapping / spelling

- Source `ZB4-BJ3` (presentation hyphen) == manufacturer `ZB4BJ3`. Both the
  catalog and se.com render the catalogue reference without the hyphen; the
  hyphen in the source is presentation only.

## Electrical vs mechanical scope

- **Electrical:** none. No contacts, lamp/LED, supply, return, signal, shield,
  communication, or PE/bond terminal exists on the head. Zero terminals.
- **Mechanical:** Ø22 panel‑mount selector actuator, long black handle, three
  maintained positions (I‑0‑II) at ±45°. Physically snap-fits to a separately
  ordered body/fixing collar (e.g. `ZB4BZ10x`) that holds the contact blocks and
  provides the screw‑clamp terminals. Optional black metal bezel = suffix `7`
  (`ZB4BJ37`); the plain reference has the standard chromium‑plated bezel.

## Modeling

- `terminals: {}`, one zero‑terminal `mechanism` function ("select") to record
  the 3‑position actuator; a `MOUNT` connectorPort documents the mechanical
  attachment only (no pins). `renderKind: accessory` (documentation view) — no
  electrical/wiring diagram exists for a bare head.
- `connectionCoverage: partial`: the electrical switching terminals reside in the
  separately ordered body/collar (out of scope for this head), and the metal
  bezel/collar‑to‑panel bonding interface is **not** documented as an electrical
  terminal, so no bond/PE path is asserted.
- No fixedLinks. A mechanical head does not join nets; contact/collar membership
  never manufactures continuity.

## Unresolved (non-blocking)

- Metal bezel/collar-to-panel bonding: not a documented electrical terminal;
  no PE path asserted through the head.
- Contact complement, terminal markings (11‑12 / 13‑14 …) and switching ratings
  belong to the body/fixing collar + contact blocks (ZB4BZ10x), a different
  order part — intentionally excluded from this head.
- Head-level IP (family up to IP66/IP67/IP69/IP69K), −40…+70 °C and standards
  (EN/IEC 60947‑5‑1, UL 508, CSA C22.2 No 14) are catalog family values, not
  required for a zero‑terminal model; recorded here for reference only.

## Files

- `research.md` (this file)
- `type.json` — one device_type `schneider-pilot:zb4-bj3` (zero terminals)
- `result.json` — decision `candidate`, conformance with empty terminal inventory

## Coordinator review correction

Coordinator correction: restored the exact source order spelling ZB4-BJ3 required by the assignment; removed an unsupported zero-terminal mechanism function in favor of the existing documentation representation. I-0-II is position notation, not an assertion of printed legends. Independently inspected exact BJ3 maintained three-position row in October2021 catalog physical57/printed55. Partial bonding coverage retained.

This correction governs the final model where the original author account above differs.
