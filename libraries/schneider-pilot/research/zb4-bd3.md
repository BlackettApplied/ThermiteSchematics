# zb4-bd3 — Schneider ZB4-BD3

## Identity

- **Manufacturer identity (verified):** Schneider Electric **ZB4BD3** — the catalog prints the
  reference without the presentation hyphen. Source `ZB4-BD3` ↔ catalog `ZB4BD3` is the same part;
  the hyphen is a source-notation artifact, not a distinct order code.
- **Type:** Harmony XB4 (metal) **selector switch operating head — HEAD ONLY**, standard (short)
  handle, black, Ø22 mm, **3 positions (1-0-2) ±45°, stay put (maintained)**.
- The source phrase "short handle" corresponds to Schneider's **standard handle** family (ZB4BD…),
  as opposed to the **long handle** family (ZB4BJ…). "45dgr / 1-0-2" matches the ±45° 3-position
  maintained scheme.

## Electrical vs mechanical scope

**This is a mechanical operating head. It has ZERO electrical terminals of its own.**

- se.com product page (ZB4BD3): "selector switch operating head", _head only — no contact block
  included; compatible contact blocks must be ordered separately._
- Catalog p.54 (physical PDF p.56), section **"Heads only (2)"**: the NO/NC contact-count columns
  are **blank** for every heads-only row, including ZB4BD3. Contacts appear only on the **Complete
  units** rows, e.g. `XB4BD33 = ZB4BZ103 (body/contact) + ZB4BD3 (head)` showing "2 NO". Those two
  NO contacts belong to the **ZB4BZ103 body**, not to the ZB4BD3 head.
- Catalog note (1) on the same page: the body "(fixing collar + contact)" associated with the head
  is a separate assembly (see catalog p.24 / p.74). ZB4BD3 is only the operator head.
- Therefore **no contacts, LEDs, supply, return, signal, communication or bonding terminals** are
  imported into this head. The mechanical position scheme (±45°, three maintained detents) is a
  documentation view, not an electrical wiring diagram.

## Bonding / attachment interface (unresolved as a terminal)

The head has a chromium-plated **metal** front bezel and a Ø22 mm panel-mount body. The catalog and
product page document **no earth/bonding terminal** on the head. Whether the metal bezel is bonded
through the panel, fixing collar or downstream metalwork is not a documented manufacturer terminal.
Following the zero-terminal-metalwork guidance, this is modeled as **zero documented terminals with
partial connection coverage**; no bonding path is asserted as a manufacturer fact.

## Separately-ordered parts (NOT part of this order code)

- Body / fixing collar (e.g. `ZB4BZ009`) + contact blocks (`ZBE-101` NO / `ZBE-102` NC …), or a
  pre-assembled body such as `ZB4BZ103`. None are included in `ZB4-BD3` and none are modeled here.
- The black-metal-bezel variant is a different code (`ZB4BD37`, "add suffix 7"). The source is
  `ZB4-BD3` (no suffix 7) → standard chromium-plated bezel head. Preserved as-is; not substituted.

## Evidence

1. **se.com ZB4BD3 product page (manufacturer).** Head-only operating head; 3 positions ±45°;
   maintained (stay put); black; metal; Ø22; unmarked; contacts ordered separately.
   https://www.se.com/us/en/product/ZB4BD3/harmony-22mm-push-button-selector-switch-operating-head-3-position-maintained-black-unmarked/
2. **Harmony XB4 metal catalog, DIA5ED2121212EN, October 2021, V13.0 (manufacturer, se.com iportal).**
   Catalog p.54 (physical PDF p.56) "Selector switches with standard handle → Heads only": ZB4BD3 =
   standard handle black, 3-position ±45° stay put; contact columns blank; complete unit XB4BD33 =
   ZB4BZ103 + ZB4BD3. **Diagram reviewed visually** (full page + 400-DPI clip of the heads-only rows,
   saved in `references/`).
   https://iportal.se.com/Contents/docs/HARMONY%20XB4%20METAL%20CONTROL%20AND%20SIGNALING%20UNITS_CATALOG.PDF

## Decision

**candidate** — identity is fully established from primary manufacturer sources, and the electrical
interface is fully understood: a mechanical operator head with **no electrical terminals**. Modeled
as a zero-terminal accessory/documentation view (`renderKind: "accessory"`) with **partial**
coverage due to the undocumented metal-bonding interface and the separately-ordered body/contacts.

## Unresolved

- Metal-bezel bonding/earthing interface is not a documented terminal on the head.
- The fitted body, fixing collar and contact blocks are separate order codes; their terminal
  inventory (e.g. NO/NC 1x-2x markings) belongs to those parts, not to ZB4-BD3.
- IP rating (e.g. IP66/IP67/IP69K) is realized by the completed assembly, not the bare head.
