# zb4-ba1 — Schneider Electric ZB4-BA1

## Conclusion

`ZB4BA1` is a **mechanical push-button head only** (Harmony XB4, metal, flush,
white, Ø22, spring return, unmarked). It contains **no electrical contacts, no
terminals, no lamp**. To function it must be combined with a separately ordered
body/contact assembly (fixing collar + contact block, e.g. `ZB4BZ101`). The head is a sub-assembly of a complete operator, not the complete switch.

Decision: **candidate**, modeled as a zero-terminal mechanical component
(electrical scope = none; mechanical scope = actuator head).

## Order-code spelling

Manufacturer catalog and product page print the code without a hyphen
(`ZB4BA1`). Same product; the hyphen is cosmetic. Type/result use the
job's `ZB4-BA1` per assignment and record the manufacturer spelling here.

## Evidence

1. **Schneider Electric USA — product page ZB4BA1** (manufacturer).
   https://www.se.com/us/en/product/ZB4BA1/head-for-non-illuminated-push-button-harmony-xb4-metal-flush-white-22mm-spring-return-unmarked/
   - Exact description: "Head for non illuminated push button, Harmony XB4,
     metal, flush, white, 22mm, spring return, unmarked."
   - Product is a **head/operator only**; a separate contact block is required;
     no illumination. Degree of protection IP66/IP67/IP69/IP69K; ambient
     -40…+70 °C. These are mechanical/environmental characteristics of the head.
   - No connection diagram (the head has no contacts); not a wiring diagram.

2. **Harmony XB4 metal — Control and signaling units, Catalog**
   (manufacturer; iportal.se.com), October 2021 — V13.0, ref DIA5ED2121212EN.
   https://iportal.se.com/Contents/docs/HARMONY%20XB4%20METAL%20CONTROL%20AND%20SIGNALING%20UNITS_CATALOG.PDF
   Catalog page 26 = physical PDF page 28 ("Spring return pushbuttons,
   unmarked"). Rendered and visually inspected (references/xb4-catalog-page-28.png):
   - Under **"Heads only"**: `ZB4BA1` = flush, **white**, weight 0.029 kg / 0.064 lb.
   - Under **"Complete units"**: `XB4BA11` (flush, white, 1 NO) is explicitly
     `ZB4BZ101 + ZB4BA1` — i.e. the contacts come from the body `ZB4BZ101`,
     the head is `ZB4BA1`. This proves the head carries no contacts itself.
   - Footnote (1): the contacts are "constituting the body (fixing collar and
     contact) associated with the head"; body/contact assemblies see page 74,
     accessories see page 88. The fixing collar and contact belong to the body,
     not to the head.

## Terminal / connection inventory

- Electrical terminals: **none** (0). No NO/NC contacts, no lamp supply/return,
  no PE/bond terminal on the head.
- Mechanical interface: snap-fit of the head to a ZB4BZ body/fixing collar
  (assembly relation, mechanical only). Any panel bonding would be provided by
  the separately ordered metal fixing collar/body, not by this head; no bonding
  path is asserted for `ZB4BA1`.
- `connectionCoverage`: **complete** — the electrical inventory of the head is
  definitively empty and fully known (mirrors the accepted zero-terminal
  mechanical-accessory pattern). The fitted body/contact block is a distinct
  ordered part outside this type's scope.

## Ratings

No switching rating is claimed for the head; electrical/switching ratings belong
to the contact block (body), not the actuator. Mechanical/environmental figures
(IP66/67/69/69K, -40…+70 °C, mechanical durability) are recorded as notes only
and are not modeled as terminal electrical ratings.

## Modeling

- `type.json`: one `device_type` `schneider-pilot:zb4-ba1`, category component,
  `terminals: {}`, `functions: {}`, `connectionCoverage: complete`, with a
  single mechanical `connectorPorts.HEAD` (no pins) documenting the actuator/
  snap-fit interface. No circuit symbols (no functions to map).
- `result.json`: decision candidate; `conformance.terminalKeys: []`,
  `requiredTerminalKeys: []`, `fixedLinks: []`, `renderKind: "accessory"`
  (zero-terminal mechanical item → documentation view, not invented wiring).

## Unresolved

- None essential to this head's identity or electrical scope. The body/contact assembly is a separate ordered part; its contact composition
  and terminal technology are not established by `ZB4BA1`.

## Coordinator review correction

Coordinator correction: the exact head-only row establishes no included contact/light blocks, but does not establish exhaustive absence of a protective-bonding interface. Replaced complete coverage and the unsupported claim that a separate collar provides bonding with partial coverage and no inferred bond. The October2021 catalog physical28/printed26 was independently inspected.

This correction governs the final model where the original author account above differs.
