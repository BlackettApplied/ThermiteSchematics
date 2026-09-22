# lc1-d32bd — Schneider Electric LC1-D32BD (TeSys D contactor)

## Identity

- Manufacturer spelling is **`LC1D32BD`** (radical `LC1D32` + coil-voltage code `BD`).
  The hyphen in the source/job code `LC1-D32BD` is a presentation separator, not a
  distinct catalog number. No successor was substituted; the exact printed radical
  and coil suffix were matched.

## Decoding of the order number (verified against Schneider B8 catalogue)

- **LC1D32** — TeSys D, 3‑pole contactor, rated operational current **32 A in AC‑3**
  (motor control up to 15 kW at 400 V), **screw‑clamp** terminal version.
  Source table B8/8 row: `… 32  1  1  LC1D32pp  0.375` under _"Connection by screw clamp
  terminals"_. The two `1 1` columns = **1 NO + 1 NC** instantaneous (built‑in)
  auxiliary contacts. (Spring‑terminal version would be `LC1D323`; lug version inserts
  a `6`. The source order has neither insert → standard screw‑clamp `LC1D32`.)
- **BD** — coil‑voltage code. DC‑supply table B8/8 & B8/10:
  `Volts 12 24 36 48 …` ↔ `JD **BD** CD ED …` for `LC1D09…D38`. So **BD = 24 V DC**,
  coil pick‑up/operate range **U = 0.7…1.25 Uc** (≈16.8–30 V). DC coils of
  LC1D09…D32 have an **integral suppression device fitted as standard, by a
- A1 positive and A2 negative per the manufacturer FAQ; a bidirectional suppressor is not proof of arbitrary coil polarity.
- Source's "AC3‑32A" and "Coil 24Vdc" therefore agree exactly with the catalogue.

## Terminal inventory — from the terminal scheme (visually inspected)

Scheme **`127266.eps`**, catalogue page **B8/79**, _"TeSys D, TeSys D Green 3‑pole
contactors … LC1D09 to D150"_ (LC1D32 is inside this family). Rendered from the PDF at
600 DPI and read directly (`references/schneider-b8-contactors-page-79-clip-20_120_260_200-600dpi.png`):

| Function    | Terminal marks (device) | Normal state |
| ----------- | ----------------------- | ------------ |
| Main pole 1 | **1/L1 – 2/T1**         | open (NO)    |
| Main pole 2 | **3/L2 – 4/T2**         | open (NO)    |
| Main pole 3 | **5/L3 – 6/T3**         | open (NO)    |
| Coil        | **A1 – A2** (24 V DC)   | —            |
| Aux. NO     | **13 – 14**             | open         |
| Aux. NC     | **21 – 22**             | closed       |

The coil rectangle drives all contacts through the dashed mechanical linkage
(actuation, **not** an electrical net). Only a single A1/A2 coil pair is shown on the
family scheme. No earth/PE terminal exists on the bare contactor.

Modeled terminal keys use the primary IEC numbers (`1..6`, `13/14`, `21/22`, `A1/A2`);
the `n/Ln`–`n/Tn` power markings are recorded in each terminal description.

## Ratings (kept as capabilities/conditions, not flattened)

- Coil A1/A2: **24 V DC** rated (this device's fixed control supply → assigned as the
  terminal rating and matches circuit intent).
- Main poles: rated operational **32 A in AC‑3** at ≤440 V (15 kW/400 V);
  AC‑1 load rating 50 A at ≤60 °C; rated up to 690 V insulation family. These are
  conditional capabilities and are **not** flattened onto a scalar main‑pole voltage.
- Aux 13‑14 / 21‑22: control‑contact capabilities (AC‑15 / DC‑13 families) not flattened;
  passive, application‑dependent contacts (not universally required).

## Continuity / fixed links

- **None.** Contactor main and auxiliary contacts are switched, not permanent nets.
  The coil’s integral bi‑directional peak‑limiting diode is a suppression element across
  A1/A2 and does **not** create an external net join. `fixedLinks = []`.

## Coverage & required connections

- `connectionCoverage: partial` — all documented electrical connection points of the
  standard part (3 NO main poles, coil, 1 NO + 1 NC aux) are modeled. No shield/comms/PE
  interface exists on this device.
- Required terminals: **A1, A2** (the coil must be energized for any function). Main
  poles and auxiliary contacts are application‑dependent → not marked required.

## Source

- Schneider Electric — **B8 Contactors** catalogue chapter (TeSys D, SK, K, GC …),
  `https://iportal.se.com/Contents/docs/B8_CONTACTORS_EN_CATALOGUE.PDF`
  (job‑hint URL `iportal2.schneider-electric.com/Contents/docs/B8_CONTACTORS_EN_CATALOGUE.PDF`
  redirects here). 126 pages,.
  Pages used: **B8/8** (AC‑3 selection, screw‑clamp), **B8/8 & B8/10** (DC coil‑code
  table), **B8/79** (scheme 127266.eps). Manufacturer‑authored, fetched from Schneider's
  own iportal domain.

## Unresolved / notes for a follow‑up researcher

- No printed edition/date appears on the extracted pages; the document is pinned by its
  iportal URL instead of a revision string.
- Detailed conditional ratings (short‑circuit coordination, AC‑15/DC‑13 aux ratings,
  screw‑clamp wire ranges/torque, UL/CSA data) are on B8/59–B8/71 and were not reduced to
  scalar terminal values; retained as notes only.
- Some TeSys D bodies expose a duplicated coil terminal for daisy‑chaining; the family
  scheme shows only a single A1/A2, so no duplicate coil terminal is modeled.

## Coordinator physical scope review

All12 labeled circuit endpoints are represented. Physical duplicate-access/clamping positions and any accessory suppression attachment geometry are not separately enumerated for the historical hardware edition; connection coverage is partial for those details. No extra terminal or fixed link is inferred. Optional external accessories remain separate.

## Coordinator polarity correction

Manufacturer FAQ FA121938 explicitly specifies A1 positive and A2 negative for LC1D***D DC coils. A bidirectional suppressor does not justify the original inference that coil polarity is arbitrary. [Primary FAQ](https://www.se.com/us/en/faqs/FA121938/).
