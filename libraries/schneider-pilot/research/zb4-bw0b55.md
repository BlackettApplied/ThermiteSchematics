# zb4-bw0b55 — Schneider ZB4-BW0B55 / ZB4BW0B55

**Decision: corrected candidate, partial coverage.** The exact sheet directly documents six physical terminal marks. The original tens-digit expansion and borrowed LED pin evidence are replaced; generic contact symbols describe the bare body without an operating head. Source **Yellow** versus manufacturer **Orange** remains unresolved.

## Exact evidence and visual recovery

The original worker's [exact current manufacturer PDF](https://www.se.com/us/en/product/download-pdf/ZB4BW0B55?filename=Schneider+Electric_Harmony-XB4-ZB4-Metal-Push-Buttons_ZB4BW0B55.pdf), printed **12 September 2026**, is 9 physical pages. Its **page 7 rear illustration** visibly identifies **six separate screw clamps**:

| Physical marks | Function                      | Normal state                          |
| -------------- | ----------------------------- | ------------------------------------- |
| 1–2, NC        | One NC contact                | Closed until that contact is actuated |
| 3–4, NO        | One NO contact                | Open until that contact is actuated   |
| X1–X2          | Integral protected-LED supply | Load; 24 V AC/DC exact nominal supply |

I inspected the full page and its unmodified embedded image, saved as `references/zb4bw0b55-current-p7-image132.jpeg`. The rear-facing illustrated LED/contact assembly shows the NO block at photo-left, LED in the middle and NC at photo-right; no installed position or selector meaning is inferred. **Page 8** provides the fitted **ZBE-101** NO circuit illustration with explicit **3–4**, saved as `references/zb4bw0b55-current-p8-image143.jpeg`. The original reading “.3/.4 = 13/14” is unsupported: a preceding diagram dot is not a missing tens digit.

The exact-sheet rear illustration supplies **X1/X2** directly. No ZB4BVB3 terminal transfer is needed. Its center block uses generic voltage placeholders and illustrative LED appearance, so it is used for terminal arrangement only, not to identify emitted color or exact ratings. The exact specifications on pages 1–2 establish those characteristics.

Both the current sheet and the [3 March 2017 exact sheet](https://iportal.se.com/Contents/docs/SQD-ZB4BW0B55.PDF) contain the abbreviated ISO field **(11-12)NC**. That field differs from the rear illustration's visible **1/2**, omits NO and lamp endpoints, and is retained as a documentary discrepancy. It is not silently converted into a second terminal inventory or a physical/application alias map. Historical installed terminal typography remains unverified.

## Composition and source differences

The exact 2017 sheet page 1 and the [October 2021 Harmony XB4 catalog](https://iportal.se.com/Contents/docs/HARMONY%20XB4%20METAL%20CONTROL%20AND%20SIGNALING%20UNITS_CATALOG.PDF), **physical 86 / printed 84**, confirm **ZB4BW0B55**: Zamak body/fixing collar, **orange** integral protected LED, direct **24 V AC/DC**, **one NO + one NC**, screw-clamp connections. Both selection evidence and terminal illustrations were visually inspected. The source order **ZB4-BW0B55** is preserved; the manufacturer order without the presentation hyphen remains an alias, not a substituted suffix.

No opened source establishes that Yellow and Orange describe the same emitted color, nor identifies the installed LED/head. The original “same physical amber/orange LED” statement is withdrawn. Manufacturer Orange and source Yellow remain separate facts.

The exact complete-unit decomposition at catalog **physical 32 / printed 30** is **XB4BW35B5 = ZB4BW0B55 + ZB4BW353**. The operating head/lens is therefore separate. The body model does not assume pushbutton operation, spring return, simultaneous actuation or head ganging; it uses `contact-nc`, `contact-no` and `lamp`, with no head mechanism or relation. Each contact has its own actuator, whose operation in an assembly depends on the separately selected head.

## Model and remaining scope

- Terminal keys **1, 2, 3, 4, X1, X2** preserve the directly illustrated marks.
- Only **X1/X2** are required, under library policy for an operating lamp. Passive contact use is application-dependent.
- Exact LED **nominal 24 V** is retained on X1/X2, with no single AC/DC type because both supplies are supported. No DC polarity or L/N assignment is invented. Operating limits **19.2–30 V DC / 21.6–26.4 V AC**, consumption **18 mA**, and **100000 h at rated voltage and 25 °C** remain documented conditions. The 50/60 Hz specification applies to AC.
- Contact capabilities remain notes: **Ith 10 A**, **Ui 600 V at pollution degree 3**, **Uimp 6 kV**; AC-15/A600 **6 A at 120 V, 3 A at 240 V, 1.2 A at 600 V**; DC-13/Q600 **0.55 A at 125 V, 0.27 A at 250 V, 0.1 A at 600 V**. No scalar contact rating or LED current is assigned.
- The NC, NO and LED functions are separate circuits. Function membership does not join nets. **No fixed links** or electrical common through the collar are asserted.
- Coverage remains **partial**: the six documented lamp/contact clamps are modeled, but the Class I collar/support/earthing interface and its installed continuity are not established. No dedicated PE point, fastening-screw-as-PE identity or automatic bond through head/panel is invented.

Original result, research, type and source claims are preserved under `original/` with `original-sha256.json`. The corrected source list excludes the unnecessary neighboring LED reference and replaces the erroneous terminal claims. Job/schema copies remain byte-identical. Files are formatted; no canonical writes, central verification or repository tests were performed. `frozen-sha256.json` records the final handoff bytes.
