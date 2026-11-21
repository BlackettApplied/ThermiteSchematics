# Nested external bridge labels

This original synthetic example has two output channels feeding a six-terminal
interface, plus two explicit wires between terminals on that interface. The
nested external bridges reproduce a fixed-port self-loop label fit failure in
the circuit renderer. S1 and D1 are partial signal-only models, with expected
W904 warnings; they make no manufacturer, supply or installed-device claims.

The saved packet draws the same four wires and three functions in both flows.
The circuit renderer reserves measured label space around self loops and can
center a caption beside a short segment when its full box clears all other
content. ELK owns every node position and complete wire route. No internal
terminal commoning is inferred.

From the built source checkout:

```sh
bun thermite.mjs validate examples/self-loop-labels
bun thermite.mjs packet --project examples/self-loop-labels --input examples/self-loop-labels/packet.json --json -o output/self-loop-labels.json
bun thermite.mjs packet --project examples/self-loop-labels --input examples/self-loop-labels/packet.json -o output/self-loop-labels.html
```

The regression tests also cover measured size/color details and compare emitted
routes directly with ELK output. A caption that cannot clear neighboring wires
still fails with R006; the renderer does not shrink text or omit connections.
