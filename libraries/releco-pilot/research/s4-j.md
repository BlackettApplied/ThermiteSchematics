# Releco S4-J — s4-j

Decision: **candidate**. Identity: `releco-pilot:s4-j`, manufacturer `Releco`, order `S4-J`. Proposal covers the bare socket only.

## Evidence

**S1:** [ComatReleco World of Relays, WoR 3.2 (English)](https://www.comatreleco.com/media/43/fd/6f/1692802495/wor_3-2_en.pdf), printed/physical PDF pp.347–348. Download retained in `references/wor_3-2_en.pdf`; acquisition sidecar records SHA-256. Visually reviewed the exact S4-J selection row on p.347, full p.348, and its figures 1–2 enlarged at 600 DPI (clip 395,202,558,447 PDF points). Page 347 explicitly routes S4-J, a screw-terminal socket for 14-pin C4 relays, to p.348.

## Connection inventory and continuity

Figure 2 depicts **14 wire clamps and 14 socket mating contacts**, each interface numbered 1–14. The socket insertion-side drawing repeats the matching numbers at the two interfaces. Each same-number pair is one passive socket conductor; no different-number paths are joined in the bare socket.

Model aliases `C.n` (clamp) and `M.n` (mating contact) distinguish these interfaces. Fourteen explicit fixed links `C.n–M.n` represent factory continuity. All 28 endpoints are application-dependent; no required endpoints. Each endpoint uses a singleton bus function and existing terminal circuit symbol. Connector metadata does not join nets.

Figure 1's physical-number → relay-function-label mapping:

| Physical number | Function label |
| --------------- | -------------- |
| 1, 2, 3         | 12, 14, 11     |
| 4, 5, 6         | 22, 24, 21     |
| 7, 8, 9         | 32, 34, 31     |
| 10, 11, 12      | 42, 44, 41     |
| 13, 14          | A1, A2         |

**Manufacturer discrepancy:** figure 2 prints `14|21` at clamp 14, while figure 1 identifies 14 as A2. Both interfaces still clearly identify physical number 14. The model keys preserve physical numbers; descriptions attribute A2 specifically to figure 1 rather than treating the conflicting legend as settled.

The coil and four changeovers in figure 1 describe relay use; they are not permanently conducting socket links or fitted socket functions. No relay, indicator, suppression circuit, PE, shield, communication interface or electrical accessory is added. Catalog coverage is complete for the bare 14-path socket. Optional plastic retention is mechanical; no conductive mounting/bond path is asserted.

## Ratings and source reconciliation

S1 p.348: rated load 10 A / 250 V; dielectric strength 2.5 kV rms / 1 minute for terminals–DIN rail and terminal–terminal. Keep voltage capability in notes, with no assigned nominal voltage or AC-only metadata. Single wire: 1.5 mm² or 2 × 1.5 mm²; uncrimped multi-wire: 0.34–1 mm². M3.5 combination screws, 0.8 Nm nominal torque. Operation −40…+60 °C; storage −40…+80 °C, no ice. PA/PC housing, TH35 or back-panel mounting.

Historical description “socket for C4” agrees with S1. Installed hardware revision remains unknown.

## Search record and limits

The exact manufacturer legacy sheet URL `https://www.comatreleco.com/wp-content/uploads/cr-prod/cr-prod-doc/EN_DAT_CAT_S4-J_00001.pdf` returned HTTP 404 on direct fetch. Its search snippet was not used as evidence. The old manufacturer product-page URL could not be opened by the web tool; the Brazil sockets page returned 502. The supplied current manufacturer catalog succeeded and provides exact-part selection and diagrams, so no neighboring component substitution was needed.

No installations, builds, repository tests, git operations or bespoke verification project were run. Central verification remains with the coordinator.
