# zb4-ba5 — Schneider ZB4-BA5

## Identity

- **Manufacturer identity:** Schneider Electric **Harmony XB4** metal push button
  **head** — flush, yellow, Ø22, spring return, unmarked. The manufacturer prints the
  reference without the presentation hyphen as **`ZB4BA5`**; the hyphenated catalog form `ZB4-BA5` is the same catalog identity.

## Electrical vs mechanical scope

- **ZB4BA5 is the head (mechanical operator/actuator) only.** It has **no contacts,
  no LEDs, no electrical terminals, no PE terminal.**
- The switching contacts are **not** part of this reference. They constitute the
  separately ordered **body = fixing collar + contact block**. The catalog proves this:
  the complete yellow unit **`XB4BA51 = ZB4BZ101 (1 NO contact block) + ZB4BA5 (head)`**.
- Physical terminal inventory of the head: **zero documented terminals.**
- Bonding/attachment interface: the head is metal (metal bezel + fixing collar) and
  snap-fits into the body and mounts in a Ø22 panel cutout. A panel-earth bond _may_
  exist through the metalwork once assembled, but **no bonding terminal is documented**
  for the head. Per modeling policy this stays **unresolved** → zero documented
  terminals, **partial** coverage. It is not asserted as a manufacturer fact.

## Primary evidence (opened)

1. **Schneider Electric product page — ZB4BA5** (manufacturer).
   https://www.se.com/us/en/product/ZB4BA5/head-for-non-illuminated-push-button-harmony-xb4-metal-flush-yellow-22mm-spring-return-unmarked/
   - "Head for non illuminated push button, Harmony XB4, metal, flush, yellow, 22mm,
     spring return, unmarked" — a **head** requiring a **separately ordered** contact
     block/body. Connection technologies (screw clamp / connector / Faston / spring
     terminal) belong to that body, not to the head.
2. **Harmony XB4 metal — Control and signaling units, Catalog** (manufacturer,
   se.com iportal), October 2021, DIA5ED2121212EN, V13.0. Local copy:
   `references/xb4-catalog.pdf` , from
   https://iportal.se.com/Contents/docs/HARMONY%20XB4%20METAL%20CONTROL%20AND%20SIGNALING%20UNITS_CATALOG.PDF
   - **PDF p.28** "Pushbuttons, spring return — unmarked". **Visually inspected**
     (full page + 400 dpi clip `references/xb4-catalog-page-28-clip-175_250_575_470-400dpi.png`).
     "Heads only / Flush" selection table lists **Yellow = `ZB4BA5`** (weight
     0.029/0.064 kg/lb). Heads-only rows have **no NO/NC contact columns**. Complete
     units column shows `XB4BA51 = ZB4BZ101 + ZB4BA5`. Note (1): the contacts
     constitute the **body (fixing collar + contact)** associated with the head.

## Modeling

- Zero-terminal mechanical item → **documentation/accessory view**. `terminals: {}`,
  `functions: {}`. A `connectorPorts` entry records the mechanical actuator/mount
  interface only ("no electrical pins"). No wiring, no fixed links, no nets.
- No contact/LED terminals imported from the complete assembly (`XB4BA51`) into this head.
- `connectionCoverage: partial` — undocumented panel-bond interface; contacts live on
  the separately ordered body.
- Decision: **candidate**. Identity and electrical scope (a head with no contacts/
  terminals) are established from primary Schneider sources; the only open item is the
  undocumented bond, which is recorded rather than invented.

## Unresolved / notes for a follow-up researcher

- Installed panel-earth bond through the metal bezel/collar is undocumented for the head.
- IP rating and operating-temperature figures were not on the fetched product-page text
  and were not chased — not needed for connection modeling of a zero-terminal head.
