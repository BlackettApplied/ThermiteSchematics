# zb4-bvb4 — Schneider ZB4-BVB4

**Decision: candidate.** Type `schneider-pilot:zb4-bvb4`, manufacturer `Schneider Electric`,
order `ZB4-BVB4`.

## Identity

Source identity: make `Schneider`, order `ZB4-BVB4`, description "Signal light assembly red".
Manufacturer prints the reference without the presentation hyphen as **`ZB4BVB4`**; the job's
`ZB4-BVB4` and the printed `ZB4BVB4` are the same product (hyphen is cosmetic). This is retained
as `orderNumber: "ZB4-BVB4"` per the assignment, with the hyphen difference documented here.

Exact part: **Complete body/light block assembly** (fixing collar + light block with integral LED)
for a Harmony XB4 metal Ø22 pilot light, **red**, **24 V AC/DC**, screw‑clamp terminals.

- Harmony XB4 metal catalog DIA5ED2121212EN (Oct 2021, V13.0), catalog p.86 / PDF p.88,
  section _"Body/light assemblies for pilot lights with integral LED → Complete light bodies
  (fixing collar + light block with integral LED), Screw clamp"_: row **Red = `ZB4BVB4`**,
  supply **`24 z` (50/60 Hz)**, 0.054 kg. ("z" = AC/DC per Schneider symbol convention.)
- Same catalog p.66 / PDF p.68 shows the **complete pilot light** `XB4BVB4 = ZB4BVB4 + ZB4BV043`:
  i.e. `ZB4BVB4` is the electrical body/light block, and the red plain lens **head `ZB4BV043`
  is a separate order** (not included in this part).
- Schneider product data sheet **ZB4BVB4** (RS mirror) and se.com product page both title it
  "Light block with body fixing collar, Harmony XB4, metal, red, integral LED, 24V AC DC".
  End‑of‑sale APR 05 2023; replacement `ZB4BVB1` (universal LED) — **not substituted here**.

## Electrical vs. mechanical scope

- **Electrical:** one steady red LED signal light. Datasheet field _"Terminals description ISO n°1
  `(X1-X2)PL`"_ → exactly **two supply terminals marked `X1` and `X2`** (screw clamp,
  ≤2×1.5 mm² with ferrule, ≥1×0.22 mm² without). The LED sits between X1 and X2.
- **Mechanical:** Zamak fixing collar (30×47×37 mm) that clips the block into the head and panel.
  It is the mounting body, **not a contact block**; this part carries **no contacts** (a plain
  pilot light) and **no BA9s bulb holder** (integral LED). No separate PE/bond terminal is
  documented — _Electrical shock protection Class I (IEC 60536)_ is achieved through the metal
  mounting/panel, not through a terminal on this block, so no earth terminal is invented.

## Ratings (datasheet ZB4BVB4, EN/IEC 60947-5-1)

- [Us] rated supply voltage: **24 V AC/DC at 50/60 Hz** (universal input, not AC‑only).
  Limits: **19.2…30 V DC / 21.6…26.4 V AC**. Current consumption **18 mA**. Signalling: steady.
- [Ui] 600 V (pollution degree 3); [Uimp] 6 kV; tightening torque 0.8…1.2 N·m; service life
  100 000 h; −40…70 °C; IEC 60947-5-4/-5-1, UL 508, CSA C22.2 No 14.

Only the exact `nominal_voltage: 24` is placed on terminals (matches a 24 V circuit intent).
`voltage_type` is intentionally **omitted** because the device is AC/DC universal; the AC/DC
capability and voltage window are kept here in notes rather than flattened to a single scalar.

## Connection inventory / nets

Two terminals, both required (library policy: functional supply terminals of a lamp are
`required: true`). The `load` (LED) function spans X1–X2 but **does not join the two nets** —
membership is not continuity. No fixed links, jumpers, ganging, contacts, communication ports,
shields or PE terminals exist on this block. Coverage is **complete** for the light block's
documented electrical terminals.

## Rendering

Single function `light` (kind `load`) → circuit symbol **`lamp`** (supported enum value).
`renderKind: "circuit"`, terminals X1, X2.

## Evidence notes / limitations

- `diagramReviewed: false` on all sources: the catalog page (PDF p.88, rendered and inspected)
  is a **selection table**, and the datasheet is a characteristics sheet — neither is a wiring
  schematic. Terminal identity (X1/X2) comes from the datasheet's explicit _Terminals description
  `(X1-X2)PL`_ field. For a two‑terminal lamp there is no pin order to scramble; endpoint order is
  electrically meaningless.
- Distinct light color of the installed signal is set by this block's red LED; the separate red
  lens `ZB4BV043` completes the visible unit but is outside this order code.

## Files

- `research.md` (this file)
- `type.json` — one device type `schneider-pilot:zb4-bvb4`
- `result.json` — decision `candidate`, conformance with terminals X1/X2

### Downloaded evidence (references/)

- `xb4-catalog.pdf` — Schneider Harmony XB4 metal catalog DIA5ED2121212EN, Oct 2021 V13.0
  (from iportal.se.com)..
- `zb4bvb4-rs-datasheet.pdf` — Schneider "Product data sheet Characteristics ZB4BVB4" (RS mirror).

## Coordinator source and scope correction

The [exact manufacturer ZB4BVB4 PDF](https://www.se.com/au/en/product/download-pdf/ZB4BVB4), dated12 September2026, was retrieved and visually reviewed: 8 body-printed lamp diagram;9 rear terminals. Its rear view shows two distinct X1/X2 screw clamps and its side view shows the lamp circuit. The alternate artwork is generically marked ZBV-XX/xx V; the historical exact sheet and catalog remain authority for24 V AC/DC and red color. This closes the initial diagram gap without claiming an installed production revision.

Final connection coverage is **partial**. Earlier wording that Class I bonding is provided automatically through metal panel mounting, or that no interface could exist, is withdrawn. Collar/support protective bonding is installation-dependent and is not modeled. No dedicated PE screw is invented. Both required lamp supply endpoints remain separate nets.

Any earlier unqualified statement of polarity insensitivity is withdrawn; no DC polarity is assigned and FAQ FA117146 is not treated as a guarantee for all body revisions.
