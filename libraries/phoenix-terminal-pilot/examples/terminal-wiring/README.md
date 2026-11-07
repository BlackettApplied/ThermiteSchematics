# Terminal wiring demonstration

This is a synthetic catalog example. Four blocks
connect to generic test endpoints. Every ordinary clamp has an external lead;
eight explicitly authored jumpers document their factory common groups.

| Device | Ordinary clamps | Explicit factory-common representation |
| ------ | --------------- | -------------------------------------- |
| XQ     | A1, A2, B1, B2  | A1-A2, A2-B1, B1-B2                    |
| XQB    | A1, A2, B1, B2  | A1-A2, A2-B1, B1-B2                    |
| XMT    | A1, A2, B1      | A1-A2 only; knife separates A from B   |
| X16    | A1, B1          | A1-B1                                  |

The `INTERNAL` jumpers are model representations of permanent busbars, not extra
installation wires or purchased bridging accessories. Do not jumper the knife.
Function state is not simulated, and no function creates physical continuity.

From the repository root, after the normal source build:

```sh
bun thermite.mjs validate libraries/phoenix-terminal-pilot/examples/terminal-wiring
node libraries/phoenix-terminal-pilot/examples/terminal-wiring/verify.mjs
bun thermite.mjs packet --project libraries/phoenix-terminal-pilot/examples/terminal-wiring --input libraries/phoenix-terminal-pilot/examples/terminal-wiring/packet.json --output /tmp/phoenix-terminal-example.html
```

Use an output path outside any component library. The packet contains four
tabloid landscape circuit sheets, selecting every authored conductor and every
catalog function. The feed-through points use distributed terminal placement so
their explicit internal-common links remain readable. The knife and its twin
point stay grouped. Generated SVG geometry comes entirely from the engine.

The baseline retains four W904 partial-coverage warnings. Unused ordinary clamps
are permitted. The verification also removes all physical links to confirm that
functions create no implicit commoning; an application-specific required point
then produces W903. Changing one library byte produces E108 until relocked.

After an intentional type edit:

```sh
bun thermite.mjs lock libraries/phoenix-terminal-pilot/examples/terminal-wiring
```
