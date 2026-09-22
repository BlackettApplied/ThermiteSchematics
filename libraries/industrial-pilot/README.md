# Industrial pilot library

This visible, editable library contains fifteen narrowly scoped manufacturer profiles.
It is a documentation pilot, not a manufacturer certification or a purchasing
release. Each type carries its source URL, document revision, page references,
and modeling limits in `catalog`. Review those notes when using a component.

| Models                                                   | Supported representation                                                         | Limits                                                                                               |
| -------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Neousys POC-610                                          | Ethernet ports, connection drawings and schedules                                | Engineering port aliases; no power connector pinout or software protocol certification               |
| ARBOR SP-151C-1N305                                      | DC input and remote switch pins; Ethernet aliases; engineering shell bond        | Partial optional interfaces; verify shell attachment                                                 |
| Siemens KP8 PN, Phoenix 2966171, PATLITE LR4-302LJBW-RYG | Console terminal wiring, external I/O and stack leads                            | See catalog metadata and console example                                                             |
| Siemens IM 155-6 PN ST bundle, 6ES7155-6AA02-0BN0        | Assembly inventory and two Ethernet ports                                        | Includes interface, BA 2xRJ45 and server module; power and backplane not modeled                     |
| Siemens AI 4xTC HS, 6ES7134-6JD00-0DA1                   | Four TC channels, terminal inventory and cable hookup sheets                     | TC mode; configure alloy and cold-junction compensation separately                                   |
| Siemens AI 4xI ST, 6ES7134-6GD01-0BA1                    | Four two-wire current input channels, terminal inventory and cable hookup sheets | Functions use UVn/2In+; four-wire operation is not selected                                          |
| Siemens AQ 4xU/I ST, 6ES7135-6HD00-0BA1                  | Four current output channels, terminal inventory and cable hookup sheets         | Functions use Qn+/Qn-; voltage sensing and actuator supply are separate                              |
| Siemens A1 BaseUnits, 6ES7193-6BP00-0DA1 and -0BA1       | Inventory                                                                        | First starts a load group; second extends the left group; group loading remains an engineering check |
| Carlo Gavazzi NRGC-PN, RGC1P60CM25KEN, RGN-TERMRES       | Ethernet/NRG ports, supply/load terminal inventory, bus drawings                 | No SSR power schematic symbol or detailed switching behavior                                         |

Analog modules retain the existing I/O profile, but the legacy continuous trace
renderer does not yet support their two-terminal analog channel paths. Use I/O
and terminal reports and `conductors` views for these hookups. Unsupported
continuous views must fail explicitly, never be presented as complete drawings.
BaseUnit landing positions appear under the installed module to avoid counting
the same physical terminals twice. Backplane rails and device functions do not
join electrical nets automatically.

The NRGC-PN terminator is supplied with the head. An inventory entry for it is
not an extra purchase quantity. The bus requires proprietary RCRGN assemblies;
the connector shape does not make them ordinary USB cables. Bus drawings do not
model cable length, shielding, individual pins, or internally distributed power.

Import this directory with an explicit relative `path`, run `thermite lock`, and
validate. Library changes require a deliberate lock update. See
`docs/communication-ports.md` in the engine for a minimal port-link example and
`packages/cli/test/industrial-pilot.test.ts` for a verified hookup fixture.

## Evidence reviewed

The three Siemens analog manual connection figures were visually checked against
their numbered terminal tables. Product selection and family information were
checked on manufacturer publications on 2026-09-06. The Neousys source is the
manufacturer-branded 2026 A1 catalog hosted on neousys.eu; socket aliases are not
asserted to match the case markings. The NRGC-PN source is its 2021 datasheet and
the SSR source is the 2026-05-29 RG..CM..N datasheet. No complete manuals are
redistributed here. Hardware wiring, purchasing suitability and commissioning
remain unverified.

### AQ 4xU/I ST: mixed current / two-wire voltage

`siemens-aq4ui-st-2wire` adds the documented two-wire voltage arrangement to
current output capability for 6ES7135-6HD00-0BA1. The existing current-only type
is preserved. [Siemens manual, 07/2014 A5E03573365-AC](https://cache.industry.siemens.com/dl/files/612/59753612/att_880087/v1/et200sp_aq_4xu_i_st_manual_en-US_en-US.pdf),
Table 3-1 on page 10, shows Qn+/Qn- for two-wire voltage and current loads.
Tables 4-1 and 4-2, pages 12-14, list +/-10 V and 4-20 mA, configurable per
channel through PROFINET GSD parameters. Thus current and voltage commands can
share one module. Record modes explicitly in project I/O signal descriptions;
Thermite does not configure or validate the PLC's range, scaling or stop state.

Channel 3 uses terminals 4 (Q3+) / 8 (Q3-); its sense positions 12/16 remain
unconnected in this two-wire arrangement. The published diagram does not show
external sense jumpers. Four-wire remote sensing is outside this profile.
The local fixture `packages/cli/fixtures/analog-output` demonstrates the voltage
pair through terminal strip, bulkhead and proposed powered actuator cordset.

### Operator console interfaces

The stock library also contains `siemens-kp8-pn-8do`,
`phoenix-plc-rsc-24dc-21` and `patlite-lr4-302ljbw-ryg`. The ARBOR HMI model now
includes DC input, remote on/off and an engineering shell-bond point. Source
references and review limits are attached to each type's catalog metadata.
`examples/operator-console` demonstrates these with the terminal wiring renderer;
full functional-symbol rendering is not claimed for these component IDs.

KP8 external points are configurable: this profile assumes eight outputs.
Require the selected X60 supply pair on the device instance; duplicated power
contacts are not externally jumpered to simulate their internal commoning.
The standard KP8 is not a safety unit. Its outputs drive suppressed relay coils,
and relay contacts switch the installed stack lights and buzzer.

The ARBOR manufacturer's manual was reviewed through a public transcript because
its official PDF endpoint returned 403. Its listed 120 W accessory adapter is
not a device consumption rating. The CHASSIS engineering point requires physical
attachment review. KP8 supply-commoning and ARBOR optional interfaces remain
explicitly partial models. No complete manufacturer documents are redistributed.
