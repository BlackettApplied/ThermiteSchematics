# Component examples

The one-component examples produced by the
[batch research workflow](../scripts/library-batch/README.md) are synthetic,
unenergized fixtures for inspecting a library model and its rendered connections.
They do not specify an installed supply, load, conductor size, protection scheme
or external protective bonding. Read the manufacturer's exact part documentation
and the component's research note before using its model in an electrical project.

## Fixture structure and continuity

Each promoted example lives at `libraries/<library>/examples/<slug>/` and uses
the canonical library through the `../..` reference in `system.json`.
`source.json` contains the component as `D1`, independent synthetic boundaries
`B1`, `B2`, and so on, and a wire from each represented terminal to its own
boundary. `boundary/` defines those test endpoints. An accessory without
electrical terminals uses a documentation view and needs no electrical boundary.

Only authored conductors join physical nets. The example's `FIXED1`, `FIXED2`,
and subsequent jumper objects express the accepted fixed internal connections
listed in `promotion.json`. Each needs applicable manufacturer evidence. Device
functions, connector-port mappings, matching labels and nearby symbols do not
create a conductive connection. A switch or relay contact remains a behavioral
function; its terminals must not be permanently joined merely to make a drawing
look connected. No fixed link should join independent poles or invent a housing
bond.

The structural checks verify that the example preserves the declared net groups,
shows the represented connections and detects disconnected required terminals.
They cannot establish that the declared pinout or proposed internal links match
the manufacturer. A required PE terminal connected to a synthetic boundary
demonstrates authored presence, not an external protective-earth path.

Partial-coverage warnings, including W904, are expected for the synthetic
boundaries and for components whose connection inventory remains incomplete.
Preserve the diagnostics and read each `connectionCoverage` note. A successful
compile or a readable packet does not turn a partial component into a complete
model. See [connection completeness](../docs/completeness.md).

## Generate and inspect a packet

Run these commands from the source checkout after installing dependencies and
building it with `bun install --frozen-lockfile` and `bun run build`. This example uses the ABB
2CDS271001R0044 fixture; substitute another promoted example's directory and
`packet.request.json` together.

```sh
bun thermite.mjs validate libraries/abb-pilot/examples/2cds271001r0044
bun thermite.mjs packet \
  --project libraries/abb-pilot/examples/2cds271001r0044 \
  --input libraries/abb-pilot/examples/2cds271001r0044/packet.request.json \
  -o alpha-out/component-examples/2cds271001r0044.html
bun thermite.mjs packet \
  --project libraries/abb-pilot/examples/2cds271001r0044 \
  --input libraries/abb-pilot/examples/2cds271001r0044/packet.request.json \
  -o alpha-out/component-examples/2cds271001r0044.pdf
```

The output extension selects HTML or PDF. The stored packet request supplies the
views and page settings; `bun thermite.mjs packet --help` lists optional paper,
orientation and index overrides. Earlier examples may use `packet.json` instead;
follow their local README for the correct input filename.

Inspect the result at its intended print size, including terminal labels,
functions, conductors, junctions and page boundaries. Generated HTML, PDF and SVG
are review outputs. Change authoritative JSON to correct electrical content and
regenerate the packet; do not edit generated geometry.

After intentional changes to a referenced library, refresh the example's byte
lock and validate again before rendering:

```sh
bun thermite.mjs lock libraries/abb-pilot/examples/2cds271001r0044
bun thermite.mjs validate libraries/abb-pilot/examples/2cds271001r0044
```

Adding a type to a library can make earlier examples' locks stale. Refresh all
affected examples after the batch's library edits are complete. A lock refresh
does not replace a fresh engineering review when a component definition changes.

## Research and promotion provenance

For each promoted component, inspect these records together:

| Record                                        | Purpose                                                                                                   |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `types/<slug>.json` in the library            | Canonical identity, terminals, functions, ratings and modeling notes.                                     |
| `research/<slug>.md` in the library           | Manufacturer links, document pages, diagram review and unresolved scope.                                  |
| `examples/<slug>/promotion.json`              | Accepted input hashes, review/report hashes, component identity, declared fixed links and fixture hashes. |
| `examples/<slug>/electrical-system.lock.json` | The library bytes currently bound to this example.                                                        |

For the example above, see the [canonical type](abb-pilot/types/2cds271001r0044.json),
[research note](abb-pilot/research/2cds271001r0044.md) and
[promotion record](abb-pilot/examples/2cds271001r0044/promotion.json).

Promotion requires a coordinator's explicit acceptance of the verifier's exact
input hashes after manufacturer-source and visual review. The provenance records
that decision and the reviewed bytes; it is not an authenticated signature or
manufacturer certification. It preserves the accepted type and research hashes
when a later library addition requires a new example lock. Changing either
accepted file requires renewed verification and review, not just relocking.
