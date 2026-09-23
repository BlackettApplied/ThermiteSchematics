# STAHL component check

This is a synthetic, unenergized example for library verification. `IN` and `OUT`
are generic test boundaries. No installed motor, lighting circuit, mating
orientation or protection coordination is asserted.

`source.json` contains the five catalog devices, external test leads and explicit
factory conductors. `packet.json` selects all three breaker poles, the connector
functions and a cap-attachment view. The plug is capped and is not modeled as
mated to either socket. All identities and limitations remain in the library.

From the Thermite source checkout, after `bun install --frozen-lockfile` and `bun run build`:

```sh
bun thermite.mjs validate libraries/stahl-pilot/examples/component-check
node libraries/stahl-pilot/examples/component-check/verify.mjs
bun thermite.mjs packet --project libraries/stahl-pilot/examples/component-check --input libraries/stahl-pilot/examples/component-check/packet.json --paper tabloid --index -o alpha-out/component-review/stahl.html
```

The indexed HTML contains five component views and two reference sheets. It is
generated outside the library. Regenerate the lock after intentional library
changes, then validate again:

```sh
bun thermite.mjs lock libraries/stahl-pilot/examples/component-check
```

Expected diagnostics are six W904 partial-coverage warnings: four electrical
catalog models and two generic test boundaries. The cap has no electrical
terminals. The verification deliberately removes wires and internal links in a
temporary copy to check missing PE diagnostics and prevent metadata from
manufacturing connectivity; it never alters this example.
