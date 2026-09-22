# Releco S7-M — s7-m

Decision: **candidate**. Exact identity: `releco-pilot:s7-m`, manufacturer **Releco**, order **S7-M**.

## Evidence

- **S1**: [RELECO by TURCK, Sockets — S7-M](https://www.mkwheatingcontrols.co.uk/download/RELECO%20bases.pdf), undated historical catalog extract, physical PDF page 12. Manufacturer-authored page mirrored by MKW Heating Controls, with Clearwater Tech footer. Saved as `references/releco-bases.pdf`. Visually reviewed full page at 150 DPI, then wiring diagram and top outline at 400 DPI. Exact S7-M heading, screw clamps and eight mating apertures are visible.
- **S2**: [QRC series S7-M](https://releco.de/en/Relays-QRC/S7-M.pdf), footer 84/0407, physical PDF page 1, Releco sheet hosted by Kühn Controls (manufacturer mirror). Opened browser-extracted text only; diagram NOT reviewed. Both bare and www hosts failed local HTTPS download with TLS unrecognized-name; browser screenshot also failed.

## Connection specification

S1 associates sequential numbers with IEC designations:

| Number | IEC |
| ------ | --- |
| 1      | 12  |
| 2      | 22  |
| 3      | 14  |
| 4      | 24  |
| 5      | 11  |
| 6      | 21  |
| 7      | A1  |
| 8      | A2  |

Eight wire clamps and eight corresponding relay mating contacts are modeled separately as C.1–C.8 and M.1–M.8. C/M are authoring aliases. Each numbered socket conductor has one fixed C.n–M.n path. The relay schematic establishes terminal association; its coil and changeover contacts belong to an inserted relay, not the empty socket. No cross-number continuity is specified.

The outline is viewed from the relay insertion/screw-access side. No numbered geometric mating-slot layout or underside pin coordinates are asserted. Coverage is complete for this bare socket's eight electrical ways; no PE, shield, communications, additional bond or fitted accessory connection is documented. DIN mounting and the retaining clip do not establish a bond. All connections are application-dependent.

## Ratings and modeling

S1 lists 10 A / 250 V; S2 separately lists rated current 10 A but rated load 6 A / 250 V. This discrepancy remains unresolved; no scalar current, nominal voltage or AC/DC restriction is encoded. These are capability statements, not supply assignments.

Singleton bus functions use the existing terminal symbol. Explicit project jumpers must represent the eight factory paths; metadata alone creates no nets. No relay, suppression module, LED, bridge accessory or successor is included. Installed revision remains unverified. Coordinator verification is pending; no project or bespoke tests were created.
