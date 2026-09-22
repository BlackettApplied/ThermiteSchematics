# gv2-rt10 — Schneider GV2-RT10 / GV2RT10

Decision: **candidate**. The exact **GV2RT10** is a 3-pole thermal-magnetic TeSys
GV2 breaker with toggle/rocker control, 4–6.3 A thermal adjustment and 138 A
magnetic trip. Preserve the job's `GV2-RT10` order spelling and
`schneider-pilot:gv2-rt10` type ID. No GV2ME/GV2P order substitution is used.

This follow-up strengthens the completed author's evidence. Its existing six
terminal keys and three-pole mechanical relation are correct, but relying on a
blurred photograph and a neighbouring-order convention was unnecessary: the same
exact-order datasheet contains an explicit applicable schematic on **page 5**.

## Exact and applicable manufacturer sources

**S1 — [Schneider GV2RT10 datasheet, manufacturer-authored Mectronic mirror](https://app.mectronic.com/dsheet/GV2RT10_SCHNEIDER-ELECTRIC.pdf),
Apr 13 2020, five pages.** Pages 1–2 establish the exact GV2RT identity,
thermal-magnetic construction, toggle control, ratings and connection ranges.
Page 4 identifies GV2RT dimensions. Page 5, _Connections and Schema_, explicitly
labels the drawing **GV2ME•• and GV2RT** within the exact GV2RT10 datasheet. The
drawing was rendered, enlarged and visually inspected; it supplies the terminal
and common-trip evidence directly.

**S2 — [Official Schneider GV2RT10 datasheet](https://iportal.se.com/Contents/docs/SQD-GV2RT10.PDF),
Dec 06 2017, pp1–2.** This independently confirms the original order, GV2RT short
name, 3P thermal-magnetic construction, AC service and toggle control. Page 2
specifies 4–6.3 A trip-unit range, 138 A magnetic trip, 6.3 A Ith, and exact
conductor/torque conditions. It has no connection schematic and is not used for
the topology claim.

**S3 — [Official GV2LE, GV2RT instruction](https://download.schneider-electric.com/files?p_Doc_Ref=S1B1986801),
S1B19868-06, 01/2021, pp1–2.** Page 1 shows GV2RT adjustment, test and ON/OFF
controls, plus separately fitted front/side auxiliary, signalling and
voltage-release modules. Page 2 shows mounting and wire-preparation/torque data.
The applicability is explicitly GV2RT; no other order's topology is extrapolated.

Local PDFs, source hashes, full page renders and
`exact-gv2rt10-schematic.png` are retained in
`../../reviewer-0334/references/`. Physical and printed page numbers match.

## Electrical inventory and function

| Pole | Line schematic terminal | Load schematic terminal |
| ---- | ----------------------- | ----------------------- |
| 1    | 1/L1                    | 2/T1                    |
| 2    | 3/L2                    | 4/T2                    |
| 3    | 5/L3                    | 6/T3                    |

The S1 p5 drawing shows three distinct pole paths and dashed mechanical
connections from the common actuator to the switching, thermal and magnetic
mechanisms. The model keeps three `contact` functions with `breaker` symbols,
normally open for the **OFF reference**, and `ganged_with` relations for common
mechanical operation. **No fixed links** join the poles or bypass any contact.
The left-hand actuator glyph and protection elements do not add coil-supply or
sensor terminals. The renderer does not simulate trip thresholds or timing.

The complete electrical scope is the **bare breaker**: six main terminals. S1 p5
shows no integrated auxiliary, alarm, PE, shield, communication or independent
supply terminal. S3 shows add-on modules as separate attachments. Their terminals
and any as-built fitted accessories are outside this exact bare order. Mounting
on a rail does not assert a protective bond.

Terminal names follow the readable manufacturer **schematic designations**;
exact punctuation embossed on an individual production unit is not claimed from
the illustrative photograph. Each terminal has explicit `required: false` as a
library policy leaving circuit wiring to the project. This is not evidence for
a two-pole or single-phase protection arrangement. The original justification
using unrelated Digest horsepower tables has been removed; no such arrangement
was established by this review.

## Ratings and connection conditions

S1 reports In/Ith **6.3 A**, adjustable thermal protection **4–6.3 A**, magnetic
trip **138 A**, Ue/Ui **690 V AC**, **50/60 Hz**, Uimp **6 kV**, and **2.5 W/pole**.
S2 labels In/trip-unit rating as the 4–6.3 A range and gives the same 6.3 A Ith.
The current field retains the published 6.3 A equipment rating, not a selected
thermal setting or wire ampacity. Capability voltage remains in notes, with no
`nominal_voltage` assignment. AC service is explicitly specified; DC use is not
inferred from another breaker variant.

Interrupting capability is conditional: Icu **100 kA at 220/230 and 400/415 V AC**,
**50 kA at 440 and 500 V AC**, and **3 kA at 690 V AC**, at 50/60 Hz under
IEC 60947-2. No universal interrupting-current scalar or coordination result is
asserted.

S1/S2 p2 and S3 p2 establish screw clamps accepting two conductors: **solid
1–6 mm²**, **flexible without cable end 1.5–6 mm²**, or **flexible with cable end
1–4 mm²**; torque **1.7 N·m**. Shared terminal policy reflects the two-conductor
clamps. The original broad flexible-wire statement is refined to retain the
ferrule distinction. These are documentation limits, not automatic sizing checks.

## Provenance and remaining limits

The immutable original research records denied Bash/Python execution, unavailable
high-resolution crops, a blurred-photo limitation and reliance on the 2017
Digest. Those failed acquisition/review steps remain preserved in
`gv2-rt10`; they are superseded here by the independently downloaded and
visually inspected exact p5 schematic and official S2/S3 sources. No claim is made
that the original worker inspected the omitted page.

Installed voltage, thermal setting, protection coordination and fitted accessories
remain project-specific.
