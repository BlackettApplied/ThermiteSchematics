# Source metadata and documentation

A packet may include `{ "format": "documentation-view-request/0.1", "kind": "io" }`.
Kinds are `bom`, `wires`, `cables`, `terminals`, `io`, `io-ports`, `network`, and
`assemblies`. Only terminal and I/O
requests accept `device`, resolving a unique UID or designation. CLI `report`
exports the same tables as CSV or printable packets. `--json` / `.json` returns
packet data, including SVGs; the query package's `buildDocumentation` API returns
structured rows and columns without drawing geometry.

Devices accept optional `nonProcurement: { "reason": "Existing site utility" }`.
The object is closed and its required string reason must contain non-whitespace
text. This is an additive source extension under the existing
`electrical-system/0.1`, device schema ID and `electrical-ir/0.1` identities:
existing files are unchanged and continue to validate. Older strict runtimes
reject the new property with E012; use a runtime supporting this extension before
authoring it. The field does not change library versions, locks, connectivity,
UUIDs or net IDs. Generated device types include it. It is never inferred from
profile, type, tag or kind. The exported `IrDevice` type and serialized
`electrical-ir/0.1` carry the same optional metadata. Omission preserves existing
IR fields and serialized bytes; this additive metadata retains the IR format
identity and does not change electrical topology or required fields.

Device types may declare `category`, `terminalOrder`, and `catalog` with
manufacturer, exact `orderNumber`, `document` (HTTPS URL, title, revision, pages),
and optional `modelingNotes`. E203 requires terminalOrder to include every key
exactly once. Instances may declare `io: { addressSpace, channels }`. Channel
keys must refer to channel functions; each assignment may contain address,
signal and usage (`in-use` or `spare`). E202 rejects unknown channels and exact
case-insensitive duplicate addresses within one authored address space. Address
spaces are case-sensitive identifiers. Addresses are opaque documentation
labels: byte/word overlap, PLC configuration and online state are not validated.

Instances may additionally declare `connectorIo: { addressSpace?, ports }`.
This identifies a connector I/O module and provides socket assignments separately
from terminal channels. The `io-ports` schedule lists every declared connector
on these modules, including ports absent from the assignment dictionary.
See [connector I/O](connector-io.md) for unknown addresses, caps and mapping limits.

Circuit drawings also accept explicit per-function `circuitSymbols` in device
types. E206 rejects unknown function keys and marks incompatible with declared
function kind, terminal count or contact state. See the [closed mark catalog and
diagnostic contract](circuit-symbols.md). The additive specialized marks preserve
existing source formats and the original continuous renderer. Successful packet
results now include an additive `coverage` inventory with explicit circuit/wiring
scope and a separate assembly/communication `coverage.topology` inventory; see
[packet coverage](circuit-views.md#packet-coverage-inventory) and
[topology coverage](topology-coverage.md). The six
guarded agent tool contracts are unchanged.

Symbol profiles are explicit: `thermite:io-module`, `thermite:terminal-strip`,
and `thermite:dc-supply`. Supported shapes are single-terminal channels and bus
points, two-terminal DC loads, and two-terminal DC sources with explicit
positive/return roles. Other shapes remain explicit omissions. Neither a part
name nor a symbol profile creates electrical continuity.

Report-column semantics and reserved endpoint references are described in the
[report topic](report-filtering.md#report-columns-and-authored-meaning).

See the [formats and compatibility hub](formats-and-compatibility.md#documentation-and-library-metadata).
