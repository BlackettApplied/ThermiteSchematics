# zb4-bvb1 — Schneider ZB4-BVB1

## Decision: candidate

Identity and the essential electrical connection inventory are established from
primary Schneider evidence. The only unresolved item is the Class I metalwork
bonding path, which is captured as `partial` connection coverage — not a blocker.

## What ZB4BVB1 is

Schneider Harmony XB4 (metal, Ø22) **"Complete light body (fixing collar + light
block with integral LED)"**, white, 24 V `z` (AC/DC), screw-clamp terminals.

- Harmony XB4 metal catalog, 10/2021, physical PDF **p.88 (printed 86)**:
  table "Complete light bodies (fixing collar + light block with integral LED)"
  lists `24 z (1) / White / ZB4BVB1`.
- Same catalog, physical PDF **p.79 (printed 77)**: the light block itself
  `ZBVB1 = Integral LED, 24 z (50/60 Hz), White` (screw clamp). Rendered p.79 and
  the enlarged left-column image show only a product photo (`ZBVBp`), no terminal
  markings — the photo is documentation, not a wiring diagram.
- Product datasheet "ZB4BVB1", 9 May 2023: "Complete body/light block assembly,
  Harmony XB4, metal, universal LED, body/fixing collar, 24V AC DC".

No contradiction to preserve.

**Scope / what is NOT included:** this reference is the body + Zamak fixing
collar + white integral-LED light block. It does **not** include the operator
lens/head; the complete panel pilot light is `ZB4BVB1 + ZB4BV013` (catalog notes
"(ZB4BVB1 + ZB4FV013)" / "(ZB4BVB1 + ZB4BV013)"). Electrical interface = the two
LED supply terminals only.

## Terminals / electrical facts (product datasheet, 9 May 2023)

- **Terminals description: ISO n°1 (X1-X2)** — two supply terminals marked
  **X1** and **X2**.
- Schneider FAQ FA117146: "X1 and X2 are the wiring terminals. They are not
  polarity sensitive." (consistent with an AC/DC universal LED).
- Screw-clamp (SE anti-loosening): ≤ 2 × 1.5 mm² with cable end / ≥ 1 × 0.22 mm²
  without; tightening 0.8–1.2 N·m.
- `[Us]` rated supply voltage 24 V AC/DC at 50/60 Hz; signalling type Steady.
- Supply voltage limits 19.2–30 V DC / 21.6–26.4 V AC; current consumption 18 mA.
- `[Ui]` 600 V (poll. deg. 3); `[Uimp]` 6 kV; service life 100 000 h @ 25 °C.
- Electrical shock protection **Class I (IEC 60536)**; fixing collar Zamak;
  net weight 0.054 kg.

## Modeling

- Two terminals `X1`, `X2` (screw clamp), both `required: true` (lamp/supply
  library policy). Not polarity sensitive.
- One function `light`, kind `load`, terminals `[X1, X2]`, circuit symbol `lamp`;
  device symbol `thermite:lamp` (a supported symbol; a 2-terminal load with this
  profile renders as a lamp).
- **No fixed link.** The LED normally conducts across X1–X2 but is a load, not a
  wire/jumper; load metadata never manufactures net continuity.
- `rating.nominal_voltage: 24` on both terminals (fixed nominal, matches 24 V
  circuit intent). `voltage_type` deliberately omitted — the block works on both
  AC and DC, so no AC-only/DC-only metadata is asserted. 18 mA consumption and
  the AC/DC limits are kept in notes, not flattened into a terminal rating.

## Connection coverage: partial

The two LED supply terminals X1/X2 are the complete **wireable** electrical
interface. Coverage is `partial` only because the datasheet's Class I (IEC 60536)
protective bonding of the metal Zamak body/fixing collar is achieved via panel
mounting with **no dedicated PE/earth terminal** on the light block. That
metalwork bonding/attachment interface is not modeled as a terminal; no bond path
is asserted as a manufacturer fact.

## Spelling note

Manufacturer prints the order code without the hyphen: **`ZB4BVB1`** (catalog and
datasheet). Job/source spelling is `ZB4-BVB1`; per instructions the type keeps the
job's `ZB4-BVB1` order number, and the hyphen is a presentation difference only.

## Unresolved

- Exact physical PE/bonding path of the Class I metal collar (no PE terminal
  documented); modeled as partial coverage, no bond asserted.
- No terminal _pinout diagram_ exists to inspect for this 2-terminal lamp;
  terminal identity X1/X2 rests on the datasheet's explicit text plus FAQ, which
  is authoritative for a non-polarised 2-wire device (nothing to scramble).

## Sources

1. Schneider Harmony XB4 metal catalog, 10/2021 — manufacturer (iportal.se.com);
   physical PDF pp.79, 88 (printed 77, 86).
2. Schneider product datasheet "ZB4BVB1", rev. 9 May 2023 — manufacturer doc,
   distributor mirror (docs.rs-online.com); pp.1–2.
3. Schneider FAQ FA117146 "What are the X1 and X2 terminals on the ZBVB1 LED
   Light Module? Are they polarity sensitive?" — manufacturer (se.com).

## Coordinator source and scope correction

The [exact manufacturer ZB4BVB1 PDF](https://www.se.com/au/en/product/download-pdf/ZB4BVB1), dated12 September2026, was retrieved and visually reviewed: 7 rear terminals;8 body-printed lamp diagram. Its rear view shows two distinct X1/X2 screw clamps and its side view shows the lamp circuit. The alternate artwork is generically marked ZBV-XX/xx V; the historical exact sheet and catalog remain authority for24 V AC/DC and white color. This closes the initial diagram gap without claiming an installed production revision.

Final connection coverage is **partial**. Earlier wording that Class I bonding is provided automatically through metal panel mounting, or that no interface could exist, is withdrawn. Collar/support protective bonding is installation-dependent and is not modeled. No dedicated PE screw is invented. Both required lamp supply endpoints remain separate nets.

Any earlier unqualified statement of polarity insensitivity is withdrawn; no DC polarity is assigned and FAQ FA117146 is not treated as a guarantee for all body revisions.
