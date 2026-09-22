# R. STAHL component pilot

13 individually researched source identities support legacy control,
motor-protection and connector documentation. Their exact order codes appear in
a representative industrial materials list. `23D01BA05` identifies an operator position within an
assembly, not a complete enclosed station. This library does not define installation wiring.

| Type suffix (`stahl-pilot:`) | Manufacturer order | Scope                                                                                        |
| ---------------------------- | ------------------ | -------------------------------------------------------------------------------------------- |
| `8527-21-11-0001`            | 8527/21-11-0001    | Three-pole motor protection, 9–12.5 A adjustment; no auxiliary contacts, ammeter or releases |
| `8570-11-306`                | 8570/11-306        | 16 A, 200–250 V AC, 2P+PE, 6h wall socket with interlocked switching                         |
| `8570-12-306`                | 8570/12-306        | 16 A, 200–250 V AC, 2P+PE, 6h plug                                                           |
| `8575-14-306`                | 8575/14-306        | Exact legacy 16 A, 200–250 V AC, 2P+PE, 6h coupler with interlocked switching                |
| `8570001140`                 | 8570001140         | Mechanical protective cap for the legacy three-pole 16 A plug                                |
| `23d01ba05`                  | 23D01BA05          | Twin pushbutton position, red 0 / green I, NC 11–12 and NO 13–14                             |
| `8570-11-407`                | 8570/11-407        | 16 A, 480–500 V AC, 3P+PE, 7h wall socket with interlocked switching                         |
| `8570-12-407`                | 8570/12-407        | Legacy 16 A, 480–500 V AC, 3P+PE, 7h plug                                                    |

The [research record](research/sources.md) identifies the manufacturer documents,
revisions, pages and unresolved differences. Complete manuals are not
redistributed. Newer successor parts and optional accessories are not inferred.
The next batch has separate research records for the
[twin pushbutton](research/23d01ba05.md),
[480 V socket](research/8570-11-407.md), and
[480 V plug](research/8570-12-407.md), with one component per research assignment.

## Connections and limits

The breaker uses the documented numeric terminals 1/2, 3/4 and 5/6. Its `PE`
terminal is a functional alias: the manual requires a protective conductor, but
the exact physical PE screw inventory remains unverified.

The connector models separate cable terminations (`C.*`) from mating
contacts (`M.*`). In the three-contact variants, `P1` and `P2` are neutral functional aliases, not stamped pin
numbers, installation L/N assignments or front-view positions. The three-pole
contact inventory is verified; exact physical markings require hardware review.
The four-contact variants use the manufacturer's `L1`, `L2`, `L3` and earth
identities. `C`/`M` are authoring prefixes; they do not establish physical cable
clamp markings or exact 7h pin positions. Numerical pin aliases require independent verification before use. All ten electrical
models retain `connectionCoverage: partial`.

The twin pushbutton has independent NC and NO functions with four verified
numbered circuit endpoints. It does not inherit an enclosure's PE terminal or
the containing assembly's voltage rating. No permanent conductor joins either
contact, including the normally closed one; contact state is not simulated.

Only explicit wires, jumpers and terminated cable cores join physical nets.
Author the fixed internal PE connection as a `jumper` between `C.PE` and `M.PE`.
For a plug, also author a fixed link for each power pole: `C.P1`–`M.P1` and
`C.P2`–`M.P2` for the three-contact variant, or each corresponding `C.L1/L2/L3`
and `M.L1/L2/L3` pair for the four-contact variant. These describe factory
conductors, not extra field wiring. Never create those permanent power-pole
jumpers for the switched socket or coupler. Switch state is not simulated.

The cable-side PE terminal is required. An internal jumper can satisfy a
connection-presence check without proving an external protective-earth supply;
the compiler does not yet trace protective continuity back to a verified source.
`connection_policy: shared` permits the explicit internal link plus an external
lead, and does not certify multiple wires under one clamp.

The cap has zero electrical terminals and no circuit function. Its mechanical
attachment cannot connect plug pins or remove a missing-power warning.

Ratings express component capability. They do not select wire size, trip
settings, upstream fuses or hazardous-area protection. The historical coupler
documents disagree on ingress protection, and connector compatibility is
revision-dependent; see the research notes before selecting installed hardware.

## Example and verification

The [first component example](examples/component-check/README.md) exercises the original five
items, 25 authored electrical endpoints, explicit factory links and the cap's
mechanical attachment. It renders five circuit/assembly views and preserves six
W904 warnings, including its two synthetic test boundaries.

```sh
node libraries/stahl-pilot/examples/component-check/verify.mjs
```

Verification covers pole separation, absent optional terminals, required PE
warnings, removal of factory links, nonconductive cap metadata and library-byte
lock enforcement.

Each subsequent component has its own focused example, including negative
connectivity checks and a generated circuit sheet:

| Component   | Example and verification                        |
| ----------- | ----------------------------------------------- |
| 23D01BA05   | [Twin pushbutton](examples/23d01ba05/README.md) |
| 8570/11-407 | [480 V socket](examples/8570-11-407/README.md)  |
| 8570/12-407 | [480 V plug](examples/8570-12-407/README.md)    |

Run each example's `verify.mjs` from the source checkout. The examples use the
visible pilot library, so all their locks must be refreshed when its declared
type files change. Negative checks use temporary snapshots and never mutate the
shared model or fixture.

## Expanded component batch

| Order number / source                  | Scope                                                                                     | Example                                    |
| -------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------ |
| [8570002140](research/8570002140.md)   | Protective cap for R. STAHL 8570/12 SolConeX 16 A four-pole (3P+PE) plug                  | [Source](examples/8570002140/source.json)  |
| [8575/12-200](research/8575-12-200.md) | Plug / 16 A / 20-25 V AC (extra-low voltage) / 50-60 Hz / 3 P / violet / no PE            | [Source](examples/8575-12-200/source.json) |
| [8575/13-200](research/8575-13-200.md) | Socket (switched, Ex) / 16 A / 20-25 V extra-low voltage / 50-60 Hz / 3P (no PE) / violet | [Source](examples/8575-13-200/source.json) |
| [8579/12-407](research/8579-12-407.md) | Plug / 63 A / 480-500 V AC / 50-60 Hz / 3P+PE / 7h / black                                | [Source](examples/8579-12-407/source.json) |

The ELV plug and switched socket use documented L1/L2/L3 identities and have no PE contact. Only the plug has fixed power paths. The 63 A plug has three power paths plus its documented PE path; exact installed orientation remains outside the partial model. Follow the [component example guide](../COMPONENT_EXAMPLES.md) for these four new fixtures.

## Component batch 05

This round adds the exact legacy 8571001140 four-pole 32 A plug cap from the 2007 manufacturer accessory table. A modern article-number equivalence is not asserted. The source code 8579801140 remains outside the library pending exact identity evidence.

| Order / research                     | Scope                                                                      | Example                                   |
| ------------------------------------ | -------------------------------------------------------------------------- | ----------------------------------------- |
| [8571001140](research/8571001140.md) | Protection cap for R. STAHL SolConeX 8571/12 plug, 32 A, 4-pole (3 P + PE) | [Source](examples/8571001140/source.json) |

Each accepted component has recorded manufacturer evidence, declared connection coverage, explicit fixed paths where supported, and a reproducible HTML/PDF example. Read the [example guide](../COMPONENT_EXAMPLES.md) before using a structural fixture as the basis for project wiring.
