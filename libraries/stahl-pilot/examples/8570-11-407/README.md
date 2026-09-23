# 8570/11-407 component check

This minimal unenergized example instantiates only the exact R. STAHL
`8570/11-407` and two explicitly synthetic boundaries. It supports the
[component research](../../research/8570-11-407.md), not a supply, load, fuse,
conductor-size or installation design. No electrical potential is invented.

`IN` supplies four test endpoints and `OUT` receives four test endpoints. Eight
wires expose every socket endpoint. `INTERNAL-PE` is the explicit fixed factory
conductor joining `C.PE` to `M.PE`; it is not an additional field-installed wire.
All three switched pairs remain separate physical nets. C/M qualify the cable
and mating sides. L1/L2/L3 preserve four-contact diagram identities; cable-clamp
legends and exact 7h positions remain unverified. This example does not establish
that `IN` is a real protective-earth supply.

`packet.json` selects all five socket functions and all nine conductors in one
tabloid circuit view. The project and generated view retain three W904 warnings,
one for the socket's partial physical inventory and one for each test boundary.

After batch integration and intentional lock generation:

```sh
bun thermite.mjs lock libraries/stahl-pilot/examples/8570-11-407
node libraries/stahl-pilot/examples/8570-11-407/verify.mjs
```

To verify this part independently while other library files are being added:

```sh
node libraries/stahl-pilot/examples/8570-11-407/verify.mjs --isolated
```

The isolated mode copies only this exact type and fixture into a temporary
directory under `.codex-reviews/component-review/8570-11-407`, generates a private
lock, and removes that directory afterward. It does not update shared locks.
`--output-dir <directory>` saves the compiler's unchanged SVG and baseline
diagnostics for inspection. SVG is generated evidence, never project source.

Verification checks the terminal and MATE inventories, ratings, absence of extra
terminals, all switched-pole separations and the fixed PE link. Negative cases
remove that link, remove all wiring, remove required cable-side PE, and alter
library bytes. The floating-PE case deliberately leaves only the internal jumper:
the presence check passes, while the test confirms the PE net contains just the
socket endpoints and no external source. All functions and conductors must be
included in the rendered view; missing declared PE produces W903 and stale
library bytes produce E108.
