# zb4-bj8 — Schneider Electric ZB4-BJ8

## Primary manufacturer evidence

- **Harmony XB4 metal control and signaling units — catalog**, Schneider Electric,
  doc `DIA5ED2121212EN`, **October 2021, V13.0** (catalog cover line "Catalog | October 2021").
  Fetched to `references/xb4-catalog.pdf` (23,713,526 bytes) from
  `https://iportal.se.com/Contents/docs/HARMONY%20XB4%20METAL%20CONTROL%20AND%20SIGNALING%20UNITS_CATALOG.PDF`.
  Byte-identical to the pre-staged `references/schneider-xb4-2021.pdf`.
- **Catalog page 55 = physical PDF page 57**, "Selector switches with long handle",
  sub-section **"Heads only"**. Visually inspected:
  - `references/xb4-catalog-page-57.png` (full page)
  - `references/xb4-catalog-page-57-clip-60_300_575_500-400dpi.png` (heads-only rows, 400 dpi)

### Exact selection row

`ZB4BJ8` — Long handle, black — **3-position ± 45°** — **Spring return from right to
center** — weight 0.040/0.088 kg/lb.

The rendered position scheme for ZB4BJ8 shows three ±45° positions with the spring-return
arrow on the **right** position returning to centre, matching the source notation
`1-0<-2` (position 2 / right returns to centre 0; position 1 / left is stay-put).

Neighbouring rows on the same page, kept distinct rather than conflated:

- `ZB4BJ7` = spring return **from left** to center.
- `ZB4BJ5` = spring return to center (both sides).
- `ZB4BJ3` = 3-position ±45° **stay put** (no spring return).
  So `ZB4BJ8` is specifically the right-to-centre spring-return long-handle head.

## Electrical vs mechanical scope — head only, no contacts

- This reference is listed under **"Heads only"** = the operator/actuator. It is not a
  complete switch and contains **no contact block**.
- Same page, footnote (1): "For recommended maximum number of contacts and sequence of
  contacts constituting the **body (fixing collar + contact)** associated with the head,
  see page 24." Contacts belong to a **separately ordered body** (fixing collar
  `ZB4BZ10x` + contact blocks); complete units combine e.g. `ZB4BZ103 + ZB4BJ3 → XB4BJ33`.
- Therefore ZB4-BJ8 has **zero electrical terminals**: no NO/NC contact terminals, no
  lamp/LED, no supply/return, no signal/communication, no documented PE terminal. Any
  contact numbering (e.g. 11-12 / 13-14) belongs to the separately ordered contact blocks
  and is deliberately **not** asserted for this head.
- The head is metal (variant "…7" adds a black metal bezel; the ordered `ZB4BJ8` is the
  standard metal head). The head-to-panel / metalwork bonding path is **not documented as
  a terminal** on this reference and is left unresolved rather than invented.

## Modeling decision

- `type.json` — `device_type` `schneider-pilot:zb4-bj8`: `terminals: {}`, `functions: {}`.
  The mechanical actuation/mounting interface is recorded as a `connectorPorts` mechanical
  descriptor (no electrical pins), mirroring the reference accessory example.
- `connectionCoverage.status = "partial"`: zero documented electrical terminals; the
  contact body and the metal-head bonding/attachment interface are outside this head's
  documented terminal scope.
- `result.json` conformance: `terminalKeys []`, `requiredTerminalKeys []`, `fixedLinks []`,
  `renderKind "accessory"` (zero-terminal documentation view). Contact membership never
  joins nets, so no fixed links are asserted.
- **decision = candidate**: identity is confirmed against the primary catalog, and the
  electrical inventory for this head-only reference is definitively zero terminals.

## Unresolved

- Metal-head bonding / attachment through the panel and fixing collar — no terminal
  documented on this reference.
