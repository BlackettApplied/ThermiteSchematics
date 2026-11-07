# `@thermite/core-library`

The Bun source alpha and public runtime ship **core 0.1.0 and 0.2.0**. These are
generic electrical models, not manufacturer-certified parts. The package version
is separate from its electrical library versions.

Core **0.1.0 is frozen** at `library/`: its bytes, paths, locator and existing
locks remain unchanged. Core **0.2.0 stays open on dev until the next release
tag, then freezes like 0.1.0**. It contains 33 provisional types (29 devices and four cables), including the L0
interfaces, L1 operator/protection/power types and L2 automation/instrumentation.

## Selection, files and locks

Select a shipped version by exact name/version, omitting `path`:

```json
{ "name": "core", "version": "0.2.0" }
```

| Version | Package directory | Lock/IR locator          | Diagnostic display root                 |
| ------- | ----------------- | ------------------------ | --------------------------------------- |
| 0.1.0   | `library/`        | `ais-shipped:core@0.1.0` | `@thermite/core-library`                |
| 0.2.0   | `versions/0.2.0/` | `ais-shipped:core@0.2.0` | `@thermite/core-library/versions/0.2.0` |

Each directory contains `library.json` and declared `types/*.json` files: thirteen
in 0.1.0 and 33 in 0.2.0. `SHIPPED_CORE_VERSIONS` inventories both. The original exported constants
and `resolveShippedCoreLibrary()` continue selecting 0.1.0;
`resolveShippedCoreLibraryVersion(version)` selects an exact version or returns
undefined. The compiler rejects unavailable versions with E032. Resolution is
relative to the installed module, with no registry, network, environment,
`NODE_PATH`, cwd-ancestor or cache discovery. Locators are internal provenance,
not authored paths or registry addresses.

Any explicit dependency `path` selects local resolution, including a library
named core. Both initializer paths now select 0.2.0; the alpha initializer
copies it into visible `libraries/core`, including LICENSE and NOTICE outside
its locked JSON sources. The runtime ships both version directories, compiled
resolver, README, LICENSE and NOTICE.

## Connection and profile review for 0.2.0

All 29 device types declare an existing catalog `thermite:*` profile directly.
Their `connectionCoverage` is **generic**: the abstract interfaces were reviewed,
while exact hardware inventories require part selection. I005 in the completeness
audit includes each device's notes and actual-part limits; it is not a compiler
warning. A model omitting connections of its own intended interface must instead
stay partial (W904). Generic coverage forbids exact-part catalog facts (E014). Each type's notes name modeled points, application-dependent use and
unmodeled features. The thirteen L0 types retain their original electrical fields. The L1/L2 additions
state no voltage/current magnitude, size or manufacturer facts; the L2 PLC/HMI
supplies declare DC class only. Their notes identify what the author must add
after hardware selection.

| Type (`core:` prefix)       | Universal required points                    | Optional by application                                                        | Unmodeled features / limits                                                                                                                                            |
| --------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| breaker-3p                  | None                                         | Three pole pairs; require both ends of used poles                              | Neutral, bonding, auxiliaries; trip suitability unknown                                                                                                                |
| contactor-3p-1no            | A1, A2 (electrical coil actuation)           | Three main pairs and 13/14                                                     | Extra auxiliaries, suppressors, bonding                                                                                                                                |
| junction-box-8              | None                                         | X1.1–X1.8, independently                                                       | Enclosure bond, shields, connectors; no commoning                                                                                                                      |
| limit-switch-2wire          | 13, 14 (sole sensing circuit)                | None in this interface                                                         | Extra contacts, electronics, bonding                                                                                                                                   |
| motor-3ph                   | U, V, W, PE                                  | None in this interface                                                         | Winding links, thermal sensors, brakes, heaters, shields                                                                                                               |
| overload-3p-1nc             | 95, 96 (sole modeled trip output)            | Three power pole pairs; require used pairs                                     | Alarm/reset contacts, electronics, bonding; suitability unknown                                                                                                        |
| plc-compact                 | L+, M                                        | X1.0, X1.1, X2.0, X2.1                                                         | I/O commons/group power, analog I/O, communications, shields, bonding                                                                                                  |
| prox-pnp-3wire              | 1, 3                                         | Output 4 (may be powered spare)                                                | Shields, configuration pins, bonding                                                                                                                                   |
| psu-24vdc                   | L, N                                         | DC +/−; require both for used output circuits                                  | Bonding, shields, sense, alarm/control; AC rating unknown                                                                                                              |
| pushbutton-nc               | 11, 12 (sole stop contact circuit)           | None in this interface                                                         | Illumination, extra contacts, bonding; no safety claim                                                                                                                 |
| supply-480v-3ph             | PE                                           | Phase outputs L1/L2/L3; require used outputs                                   | Neutral, upstream equipment/protection, capacity, extra bonding                                                                                                        |
| terminal-block-8            | None                                         | Isolated points 1–8                                                            | PE terminals, shields, jumpers, multiple landings, bonding                                                                                                             |
| cable-2pair-shielded        | No terminal requirements in cable schema     | Review use/spare dispositions for 1+, 1−, 2+, 2−; omitted cores are unassigned | **Reviewed partial:** four conductors and shield/construction are modeled; shield/drain termination, PE, connector pinouts and electrical suitability remain unmodeled |
| pushbutton-no               | 13, 14 (sole momentary NO circuit)           | None in this interface                                                         | Illumination, extra contacts, bonding; author must select ratings                                                                                                      |
| estop-nc                    | 11, 12 (sole maintained/latching NC circuit) | None in this interface                                                         | Redundant channels, monitoring, bonding; no safety claim; latch behavior is descriptive                                                                                |
| selector-2pos               | 13, 14 (sole maintained contact circuit)     | None in this interface                                                         | Extra poles/positions, illumination, bonding; position 0 open, position 1 closed; no simulation                                                                        |
| pilot-light                 | X1, X2 (sole indication load)                | None in this interface                                                         | Colors, drivers, test/dimmer, bonding; author must add voltage, AC/DC class and polarity                                                                               |
| relay-1co                   | A1, A2 (coil actuation)                      | Common 11 and throws 12 (NC), 14 (NO); require common and used throws          | Suppression, electronics, extra contacts, bonding; author must add coil voltage/AC/DC and contact ratings                                                              |
| fuse-1p                     | None                                         | One pole pair; require both used ends                                          | Neutral, bonding, indicators, auxiliaries; author must add ratings, fuse class and protection data                                                                     |
| fuse-2p                     | None                                         | Two independent pole pairs; require used pairs                                 | As fuse-1p; no common trip mechanism is inferred                                                                                                                       |
| fuse-3p                     | None                                         | Three independent pole pairs; require used pairs                               | As fuse-1p; no common trip mechanism is inferred                                                                                                                       |
| breaker-1p                  | None                                         | One pole pair; require both used ends                                          | Neutral, bonding, auxiliaries; author must add voltage/AC/DC, current, trip and interrupting/coordination data                                                         |
| breaker-2p                  | None                                         | Two ganged pole pairs; require used pairs                                      | As breaker-1p                                                                                                                                                          |
| control-transformer         | H1, H2 (primary feed)                        | Secondary X1/X2; require both for each used output circuit                     | Taps, extra windings, shield/frame bonds; author must add voltages, frequency, VA, protection and bonding                                                              |
| terminal-pe                 | PE (sole protective bonding point)           | None in this interface                                                         | Separate landings, rail/chassis bond, jumpers, shields; no implicit commoning or bond                                                                                  |
| cable-power-4core           | No terminal requirements in cable schema     | Review both ends and use/spare status of L1/L2/L3/PE                           | Reviewed generic four-core inventory; neutral, shield/drain, connector pinouts, size, colors, materials, ratings and suitability unspecified                           |
| plc-8di-8do-2ai             | L+, M                                        | DI0–DI7, DO0–DO7, AI0+/AI0-, AI1+/AI1- and ETH                                 | Separate commons/group feeds, channel technology/mode, ratings, connector, shields and bonds unspecified                                                               |
| hmi                         | L+, M                                        | ETH (offline operation allowed)                                                | Extra feeds/ports, display/operator functions, ratings, connector, shields and bonds unspecified                                                                       |
| transmitter-2wire-4-20ma    | +, − (sole loop interface)                   | None in this interface                                                         | Measured quantity, range, compliance, load limits, supply ratings, shield/drain and case bond unspecified                                                              |
| level-switch-no             | 13, 14 (sole dry contact, normal open)       | None in this interface                                                         | Extra contacts/electronics, process setpoint, shields/bonding; reference level must be authored                                                                        |
| disconnect-3p               | None                                         | Three ganged contact pairs; require used pairs                                 | Neutral, bonding, auxiliaries, isolation/switching suitability and ratings unspecified                                                                                 |
| cordset-sensor-4core        | No terminal requirements in cable schema     | Review both ends and use/spare status of 1–4                                   | Connector ends/pins, shield/drain, PE, colors, size, construction and ratings unspecified                                                                              |
| cable-instrumentation-1pair | No terminal requirements in cable schema     | Review both ends and use/spare status of 1+/1−                                 | Shield/drain, PE, connectors/pins, colors, size, construction and ratings unspecified                                                                                  |

The four cables are the **profile/coverage-field exception**: `cable_type` has no
`symbol`, `connectionCoverage` or terminal `required` property. Their reviewed
inventory limits are documentation, not engine coverage declarations. Cable
conductor views use physical cores rather than device profiles; no schema
extension is needed. The new power cable leaves size and construction absent;
its required color strings are empty to represent unspecified colors, including
PE. This is not a selected cable, color code or bonding arrangement.
Review explicit use/spare dispositions for every core. The engine permits an
omitted core and reports it as unassigned; it does not require every core to be
listed. Legacy two-ended assignments may omit usage, while null endpoints need
an explicit spare declaration.

The overload's 95/96 trip pair is required because the trip contact is the only
modeled output; unwired, the overload cannot interrupt its load. This is an
interface modeling obligation, not an electrical rating or protection-suitability
claim. Power pole use remains application-dependent.

Spare I/O is an instance channel disposition, not a library connection review.
Only terminals used exclusively by explicitly spare channels receive that
unconnected disposition. It does not waive required supplies/commons, partial
coverage, deferred work or project-specific requirements. Optional points still
need application review; promote used pairs/channels with `connectionReview`.

The starter deliberately leaves PS1.L/N unfed, with existing `deferred` reviews
and reasons. W905 retains the missing universal requirement and connection state
and discloses the deferral. A fresh starter has zero I003 and zero W904, but `validate --strict`
exits 1 until the feed is designed and its review completed. The fresh cabinets
template exits 0 under strict validation. Reviewed generic models with all required
points connected do not incur W904. Zero I003 means reviewed coverage, not
complete wiring or electrical safety. See
`thermite guide completeness`.

## Deliberate migration

Existing projects and copied libraries never update automatically. For a shipped
dependency, change its version to 0.2.0, run `thermite lock`, inspect the source
and lock diff, validate, review completeness and render. Type IDs and UUIDs need
no change; required points can introduce warnings. Genuine partial models retain
W904; generic interfaces carry I005 in the completeness audit.

For a visible local copy, compare and preserve project-specific changes before
replacing its files with 0.2.0. Update the dependency version as well as the local
manifest, regenerate the lock and perform the same review. There is no automatic
migration command. Keep LICENSE and NOTICE when sharing copied libraries.

## L1 marking and rendering limits

Operator markings follow the existing core NO 13/14 and NC 11/12 conventions;
coil A1/A2 and line/load pole labels follow the contactor and breaker.
For fuse and breaker terminal labels, L/T denote line and load side only, not
phase or polarity; a DC circuit can therefore use 1/L1–2/T1. Relay
11/12/14 is a conventional changeover label set; lamp X1/X2 and transformer
H1/H2/X1/X2 are generic terminal conventions. PE and cable L1/L2/L3/PE are
logical protective-earth/phase labels. None is a manufacturer's pinout, a color
assignment or a rating. The changeover shares common 11 between two contact
functions; relationships never join nets. Maintained behavior is descriptive; the schema does not simulate state retention
or safety performance. Core 0.2.0 uses `thermite:estop` for a mushroom-head
operator with a latch mark and `thermite:selector` for a maintained rotary
selector with detents. Both retain their parent pushbutton/switch function and
family support. Custom types opt in through `symbol`; names and descriptions
do not select operator identity. Core 0.1.0 bytes remain frozen.

Every device except the two-wire transmitter can be drawn in circuit views and
schematic packets. The transmitter currently has signal-loop support only. Rooted support
is narrower: protection poles have power bindings, operator/relay contacts have
control bindings, and lamps have control load bindings. Transformer windings have
only circuit bindings. Loads selection does not traverse contacts or coils.
The shipped `versions/0.2.0/types/*.json` files declare profiles and function
shapes; `thermite guide symbols` lists their catalog family support. A legacy
control root requires a coil. A valid profile does not promise that every family
can render that function or use it as a root. Fuse elements use `other/2`, which
retains the fuse glyph without asserting or printing an NC contact state.

Hardware choice, voltage ratio, AC/DC suitability, primary/secondary protection,
conductor sizing and E-stop safety performance remain author responsibilities.

## L2 interface conventions and limits

The larger PLC is a new type beside the unchanged `plc-compact`. DI0–DI7 and
DO0–DO7 identify single-terminal logical channels. AI0+/AI0- and AI1+/AI1-
identify two separate paired inputs; isolation and shared returns unspecified.
L+/M is the DC supply, with voltage not specified; ETH is a logical Ethernet port. The HMI uses the same supply/port scheme and the existing
`thermite:io-module` electrical-interface profile; it does not draw a screen.
These are provisional generic keys, never a manufacturer's pinout. The Ethernet
connector is explicitly `unspecified`; no protocol, physical connector or pin
mapping is implied. Supply voltage magnitude and I/O technology/modes stay absent. Select
hardware and add its commons, group feeds, analog configuration, ratings and bonds
before assessing compatibility. In particular, a 4–20 mA loop requires an
appropriate configured input and loop supply; the generic AI pair asserts neither
a shunt nor a powered input. Functions/feed relations never join physical nets.
Digital roles follow `plc-compact`: `digital_input_N` and `digital_output_N`;
paired inputs use `analog_input_N_positive`/`analog_input_N_negative`. The NO
level contact uses `no_contact`, as in existing core NO contacts.
I/O addresses, signals and spare dispositions belong on the device instance.

The transmitter's +/− are logical loop markings; 4–20 mA identifies its class,
not a process range or a voltage rating. The NO level switch follows core's
13/14 convention and authors normal state explicitly; the project must identify
its reference level and actuation meaning. The additional three-pole disconnect
supplies RM3's separate switching interface. It follows core's line/load labels,
with three normally open, mechanically ganged poles and the canonical
`thermite:disconnector` profile. Opting in asserts author-selected
disconnector-function identity. Isolation suitability (impulse withstand, contact
gap, position indication, lockability), load-break and ratings are not asserted.
Operation means, protective trip and safety performance are unspecified.

The power cable's short description retains the same four-core interface. Every
used core needs two explicit ends, and unused cores need project spare review.
Neutral, shield/drain, connectors and bonding beyond explicit PE terminations
are unmodeled. Size, color, materials, voltage rating and suitability are
unspecified; the author must select cable and add them. L1/L2/L3/PE are logical
phase/PE conventions, not connector pins or a selected color code.

The sensor cordset is a four-core inventory, with logical IDs 1–4 and unspecified
connector ends/pin mappings. A three-wire sensor can use three cores and retain
an explicit spare; the numbers do not specify an M12 or other connector pinout.
The instrumentation cable is one logical pair, 1+/1−; those IDs do not assign
physical conductor polarity. The existing `cable-2pair-shielded` instead has two
pairs and fixed shield/construction/size facts, so it does not cover an
unspecified single pair. Neither new cable declares shield presence or absence,
size, construction, PE, bonding or a voltage rating. Required color strings are
empty (unknown), as in the power cable. Reviewed cable inventories and these
limits live here because the cable schema has no notes, profile or coverage
fields. No shield/drain or connector connection is silently added.

Rooted automation supply/loads bindings accept the authored DC class on these
PLC/HMI supplies, without a voltage magnitude. PLC DI/DO
channels have control bindings; paired AI channels have circuit and signal-loop
endpoint support, but no rooted control binding. The level switch has circuit
support only. The disconnect has open-state circuit, power and control contact
bindings, with a shared blade, gap and fixed-contact disconnector bar. Only
authored `ganged_with` relations permit mechanical gang ink; no manual-operator
linkage is drawn. Control retains switch traversal, with no loads or signal-loop
binding. Closed-state profile defaults refuse rendering; no closed mark or new
override value is provided. The transmitter's existing
profile supports direct transmitter-to-AI signal-loop wiring only; a normal
series loop through its power supply fails R006, with or without an auxiliary
supply pair. Circuit/rooted requests report the pinned unsupported-profile gaps. `thermite guide symbols` shows current family support.

| Fixture deliverable    | Result in both flows     |
| ---------------------- | ------------------------ |
| RM3 `view PS1 --loads` | Draws B1, HMI1 and PLC1. |

The combined RM3 loads view uses bounded junction routing; the former W1012/W1014
collinear R004 is resolved without omitting a supply or return conductor.
