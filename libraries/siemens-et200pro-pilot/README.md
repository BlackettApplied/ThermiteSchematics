# Siemens ET 200pro pilot library

Seven individually reviewed models cover six electronic/connection-module
assemblies and one SITOP selectivity module. The library is visible JSON and uses
Thermite's existing `thermite:io-module` profile, explicit circuit marks, terminal
wiring views, and connector assembly views. This is a connector inventory, not a
simulation of a complete powered rack.

| Type suffix (`siemens-et200pro-pilot:`) | Electronic module  | Connection module  | Inventory                       |
| --------------------------------------- | ------------------ | ------------------ | ------------------------------- |
| `im154-4-pn-hf-cm-m12-7-8`              | 6ES7154-4AB10-0AB0 | 6ES7194-4AJ00-0AA0 | 10 power pins; 2 Ethernet ports |
| `di8-hf-cm8-m12`                        | 6ES7141-4BF00-0AB0 | 6ES7194-4CB00-0AA0 | 8 sockets × 5 pins              |
| `dq4-2a-hf-cm4-m12p`                    | 6ES7142-4BD00-0AB0 | 6ES7194-4CA10-0AA0 | 4 sockets × 5 pins              |
| `ai4-u-hf-cm4-m12`                      | 6ES7144-4FF01-0AB0 | 6ES7194-4CA00-0AA0 | 4 sockets × 5 pins              |
| `ai4-i-hf-cm4-m12`                      | 6ES7144-4GF01-0AB0 | 6ES7194-4CA00-0AA0 | 4 sockets × 5 pins              |
| `ao4-u-hf-cm4-m12`                      | 6ES7145-4FF00-0AB0 | 6ES7194-4CA00-0AA0 | 4 sockets × 5 pins              |
| `6EP1961-2BA41`                         | SITOP PSE200U      | —                  | 12 screw positions              |

The assembly catalog field explicitly lists both constituent order numbers. It
is not a purchasable single Siemens order number. Connection modules are part of
the identity: the eight-socket DI assembly leaves pin 2 unused, while the
alternative four-socket DI connection module puts additional inputs on pin 2.
No other part or revision inherits these definitions automatically.

These models are based on public manufacturer documentation. Each installation
requires independent part selection and connection review.

## Verified external pin maps

Keys such as `X1.2` mean connector X1, physical pin 2. Signal names in descriptions
are labels on that physical position, not extra terminals. Channel numbers start
at zero; connector numbers start at one.

| Assembly         | Pin 1      | Pin 2      | Pin 3 | Pin 4  | Pin 5 |
| ---------------- | ---------- | ---------- | ----- | ------ | ----- |
| IM power X03/X04 | 2M         | 1M         | FE    | 1L+    | 2L+   |
| DI X1–X8         | Us         | Unassigned | 1M    | DI0–7  | FE    |
| DQ X1–X4         | Unassigned | Unassigned | 2M    | DQ0–3  | FE    |
| AI voltage X1–X4 | Us         | U0–3+      | 1M    | U0–3−  | FE    |
| AI current X1–X4 | Us         | I0–3+      | 1M    | I0–3−  | FE    |
| AO voltage X1–X4 | Us         | QV0–3+     | 1M    | QV0–3− | FE    |

X03 is a five-pin male 7/8-inch supply feed; X04 is its female loop-through
connector. X03 pin 4 (electronics 1L+) and pin 2 (electronics return 1M), plus the
X03 assembly connection, are required. Load power on pins 5/1 is application
dependent. The two M12 D-coded PROFINET interfaces remain communication `ports`.
Their documented physical signal/thread assignment is in the model notes;
physical Ethernet conductor endpoints are outside this version's coverage.

SITOP keys `+24V.1`/`.2` and `0V.1`/`.2` distinguish duplicate screws;
`NF.1`/`.2` are the two unassigned positions. The suffixes are authoring
identifiers, not additional printed numbers. Outputs are `1`–`4`; `S` is a serial
status output and `RST` is the remote reset input. The relay-contact arrangement
of a different SITOP variant does not apply.

Either duplicate supply screw can be used. The schema cannot express “at least
one of these two,” so neither duplicate screw is marked universally required.
Projects must require their chosen supply and electronics-return screws using
`connectionReview`, as the example does. Load returns go directly to the supply;
SITOP's 0 V screws supply its internal electronics only.

## Evidence

- [ET 200pro operating instructions](https://cache.industry.siemens.com/dl/files/852/21210852/att_857898/v1/et200pro_operating_instructions_en-US_en-US.pdf),
  09/2015, A5E00335544-AJ: pp.92–95 IM connector identities and pins; p.258 CM IM
  identity; pp.264–267 connection-module identities; p.309 IM identity;
  pp.339–340 DI; pp.354–355 DQ; pp.407–408 AO voltage. The 2015 manual's older
  AI module revisions are not substituted for the exact `01` modules below.
- [ET 200pro operating instructions, current primary endpoint](https://support.industry.siemens.com/cs/attachments/21210852/et200pro_operating_instructions_en-US_en-US.pdf),
  08/2025, A5E00335544-AR, tables 6-22/6-23, pp.122–124: exact AI voltage/current
  connector tables. These tables were read in indexed Siemens primary text;
  direct retrieval returned HTTP 403 and the indexed cache copy returned 404.
  Table 6-22 labels X1 pin 2 `DI0+` while the other voltage channels are `U+`.
  The model describes that voltage input as U0+ and preserves physical X1.2.
- [Exact AI voltage product](https://mall.industry.siemens.com/mall/en/EN/Catalog/Product/6ES7144-4FF01-0AB0)
  and [exact AI current product](https://mall.industry.siemens.com/mall/en/ae/Catalog/Product/6ES7144-4GF01-0AB0)
  corroborate the `01` identities. The [Siemens connector compatibility table](https://support.industry.siemens.com/cs/attachments/50102465/cable_and_connector_for_ems_en.pdf),
  changed 12 July 2022, p.1, pairs them with CM IO 4 × M12. That table was also
  read through indexed primary text.
- [SITOP selectivity modules manual](https://cache.industry.siemens.com/dl/files/004/108989004/att_911004/v1/A7579-A1-4-76_MANUAL_SITOP-PSE200U_en-US.pdf?download=true),
  04/2019, C98130-A7579-A1-4-7629: pp.11–13, especially the exact `-2BA41`
  twelve-position table on p.12; p.15 signaling; p.45 installation.
  [Compact instructions](https://cache.industry.siemens.com/dl/files/451/61777451/att_864135/v1/A5E36629020-1-XA_OP-INST_SITOP-PSE200U_2015-11-02.pdf),
  09/2015, A5E36629020, pp.1–4, corroborate output range and serial status.

No manufacturer manuals are included in this library.

## Coverage and validation

All models explicitly declare partial coverage. Backplane contacts, internal
power distribution, protective behavior, mounting bonds, channel configuration,
and SITOP front current-measuring points are not modeled. A function or repeated
signal label does not short terminals. Unassigned pins remain inventoried; the
compiler does not currently prohibit wiring one.

`connectorPorts` records physical sockets and their documented pin identities.
An assembly relation records occupancy and its unresolved mapping state. Neither
creates a conductor or joins nets. Explicit wires, jumpers, and terminated cable
cores remain the authority for electrical continuity. A connector can be occupied
while its required power pins still produce missing-connection warnings.

The [connector wiring example](examples/connector-wiring/README.md) exercises all
seven models, selected SITOP power requirements, exact DI and differential
analog pins, and a separate power-harness assembly. Its verification checks
inventories, physical net separation, rendering, missing-power warnings, and
library-lock integrity. This example is synthetic and is not an installation
design.
