# s3-b — Releco (ComatReleco) S3-B

## Identity

- Decision: **candidate**. Exact order S3-B is a catalogued part with a full
  datasheet and a reviewed wiring/terminal diagram, so the connection inventory is
  established.

## Primary evidence

- **ComatReleco "World of Relays" (WoR) 3.2** catalogue, English, downloaded from the
  manufacturer site (`comatreleco.com`). Saved to `references/comatreleco-wor-3-2-en.pdf`
  (, 492 pages).
- **p.336** is the S3-B datasheet: "11-pin C3 Relay socket | Time Cubes compatible |
  screw terminal". Reviewed `fig. 1 Wiring diagram` at 600 dpi
  (`…-page-336-clip-370_100_565_275-600dpi.png`).
- p.335 (11-pin socket index → S3-B p.336), p.332 (socket/relay selection table),
  pp.330–331 (retaining-clip selection), p.382 (S3-BC coding ring, RD1/RD16 diode
  modules) corroborate accessory scope.
- Brand note: the catalogue is branded **ComatReleco** (Comat Releco AG). "Releco" is
  the historical product brand and the source `make`; the part is the same S3-B.

## Ratings / construction (p.336, capabilities — see modeling notes)

- Rated load **10 A / 300 V** (AC/DC not split in the datasheet → treated as a
  capability, no `voltage_type`/`nominal_voltage` authored).
- Dielectric strength 2.5 kV rms/1 min (all terminals–rail and terminal–terminal).
- Conductor 4 mm²/AWG12 single or 2×2.5 mm²; M3 Pozi screw, 0.7 Nm.
- Mounting TH35 (EN 60715) or back-panel; op. −40…60 °C; 55 g; PA/PC housing.
- Standard EN 60664-1. Included accessory: retaining clip **S30-CM/10**. Optional:
  retaining springs **HF-32 / HF-33**, coding ring **S3-BC** (separate orders).

## Pinout (fig. 1, visually verified at 600 dpi)

Bold value = socket screw-terminal marking (1–11); parenthetical = relay-pin IEC
function on a plugged **C3** (3 CO) relay:

| Screw | Relay pin | Role             |
| ----: | :-------: | :--------------- |
|     1 |    11     | contact 1 common |
|     2 |    A1     | coil             |
|     3 |    14     | contact 1 NO     |
|     4 |    12     | contact 1 NC     |
|     5 |    22     | contact 2 NC     |
|     6 |    21     | contact 2 common |
|     7 |    24     | contact 2 NO     |
|     8 |    32     | contact 3 NC     |
|     9 |    34     | contact 3 NO     |
|    10 |    A2     | coil             |
|    11 |    31     | contact 3 common |

Contact groups 1(11/12/14), 2(21/22/24), 3(31/32/34) plus coil A1/A2 are
self-consistent for a C3 undecal 3-CO relay. Text extraction scrambled 5/6 → I
relied on the rendered diagram (5=22, 6=21).

## Modeling

Bare socket = passive wiring base of **11 independent pins**. Each pin has a
wire-side screw clamp (`C.n`) and a relay-side mating contact (`M.n`) that are the
two ends of one internal conductor → one **fixed link** `C.n–M.n` per pin (factory
continuity, plug.json pattern). No PE/bond terminal exists on an 11-pin relay socket.

- **No relay behavior is modeled.** The coil and three CO switches drawn in fig. 1
  belong to the plugged C3 relay, not to this socket. There are **no cross-pin
  jumpers**; installed relay contact positions are not permanent socket links.
- `connectorPorts.MATE` documents the 11-pin relay-facing interface keyed by IEC
  function → `M.n`. Exact angular pin positions / keyway of the circular 11-pin
  layout are not given (only a functional diagram + 11-pin icon) → not invented.
- Accessories S30-CM/HF-32/HF-33/S3-BC are mechanical separate orders, excluded.
- Ratings kept as notes/`current: 10` capability; 300 V left in notes so the
  compiler does not read it as circuit intent, and no AC-only metadata is assigned
  to a socket rated for both AC and DC.

## Unresolved (non-blocking)

- Exact angular pin coordinates / keyway orientation of the 11-pin circular base.
- AC/DC breakdown of the 10 A / 300 V rated load (datasheet gives a single figure).

## Coverage

`complete` — all 11 pins are inventoried as clamp + mating-contact pairs with the
verified screw↔relay-function map; the only open items are physical geometry and
installed-revision details, which are not additional electrical terminals.
