# Electrical drawing comparison protocol

Use a synthetic, independently authored electrical JSON project to evaluate
rendering and documentation. Keep electrical source, visible component libraries,
byte locks and packet requests together. Record the engine revision and runtime.

## Circuit and conductor acceptance

- Trace three-phase supply through protection and contactor poles to a motor,
  then locate the same contactor’s coil and overload feedback by stable identity.
- Preserve parallel control branches, PLC channel assignments, wire numbers and
  separate returns through compilation and page composition.
- Use recognizable contact, coil, protection, motor, heater and sensor symbols.
  Keep complete circuits legible at the intended physical print size.
- Account for every authored conductor or record a specific coverage exception.
  Check emitted functions, wire identities and endpoints against source topology.
- Device functions describe behavior without joining terminals. Transformers,
  relays, PLC channels and protection devices must not imply electrical shorts.
- Exercise both drawing flows, shared terminals and symbol attachment. Preserve
  actual endpoints when compacting rails; common nets alone never imply junctions.

## Connectors and assemblies

A connector inventory may include rack ports, cordsets, field devices, protective
caps and splitters without asserting individual pin wiring. Assembly identity and
connector occupancy must not create invented electrical nets. Model known physical
conductors separately, preserving endpoint pairs and any authored color labels.

Check occupied connectors, unconnected ports, protective caps, terminal stubs and
explicit spare capacity as distinct states. Require all modeled conductors,
functions, assembly relations and network links to appear in the selected packet.
See [connector assemblies](connector-assemblies.md) and the manufacturer-backed
[ET 200pro pilot](../libraries/siemens-et200pro-pilot/README.md).

## Evidence and review

Record command results, compiler diagnostics, topology assertions, conductor
coverage and generated-output checks. HTML, PDF and schedules must derive from
the same compiled source. HTML embeds the generated SVG sheets.

Inspect every generated electrical sheet at its intended print size. Review wire
labels, terminal alignment, junctions, crossings, repeated device references,
page boundaries and text size. Page-count parity is not an acceptance criterion.
Readable circuit groups, complete inventories and meaningful labels take priority.
Document density and layout limitations without concealing missing conductors.

## Manufacturer library boundaries

Support exact catalog models with public manufacturer URLs, document revisions,
terminal inventories and explicit exclusions. Abbreviated family names do not
establish exact part numbers, hardware revisions or physical pin assignments.
Unresolved engineering information remains visible and separate from renderer
acceptance. Submit original component definitions and concise evidence notes;
link to manufacturer manuals rather than redistributing them.
