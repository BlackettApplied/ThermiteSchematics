# Releco C4-A40FX/24VDC — c4-a40fx-24vdc

Decision: **candidate**. Scope is the bare relay, not its separately ordered socket.

## Primary evidence

**S1:** [ComatReleco, World of Relays, WoR 3.2](https://www.comatreleco.com/media/43/fd/6f/1692802495/wor_3-2_en.pdf), printed/physical pages **55 and 11**. Downloaded from the manufacturer to `references/wor.pdf`; acquisition metadata and extracted text are retained alongside it.

Page 55 identifies C4-A40 as the AgNi version of C4-A4x; the **C4-A4xFX/DC...V** selection row includes **24 V**. Completing this manufacturer's pattern yields **C4-A40FX/DC24V**. The source's **C4-A40FX/24VDC** places the same voltage tokens in a different order. This equivalence is an interpretation of the explicit selection table, not a claim that the literal source spelling is printed there. Manufacturer and order fields retain the requested historical spelling. The source's four-pole description agrees; no source rating is asserted.

Visually reviewed the full page 55, exact FX/24 selection and figures 1 and 4, then enlarged figure 1 at 600 DPI (`wor-page-55-clip-390_210_560_280-600dpi.png`). Also visually reviewed page 11's **C2–C9 FX** diagram, which establishes A1 positive/A2 negative, LED, series polarity diode and freewheeling diode. The X option alone is different.

## Independent connection inventory

| Pole/function | Physical common  | Physical NC      | Physical NO | Corresponding IEC labels |
| ------------- | ---------------- | ---------------- | ----------- | ------------------------ |
| 1             | 3                | 1                | 2           | 11 / 12 / 14             |
| 2             | 6                | 4                | 5           | 21 / 22 / 24             |
| 3             | 9                | 7                | 8           | 31 / 32 / 34             |
| 4             | 12               | 10               | 11          | 41 / 42 / 44             |
| Coil          | 13 = A1 positive | 14 = A2 negative | —           | A1 / A2                  |

Fourteen physical Faston.110 pins total, with no additional electrical interface on this bare relay. Figure 1 directly pairs the physical numbers with IEC function labels. Figure 4 shows the pin face; interpreting it as looking toward the projecting pins is a viewing-side inference. No orientation-dependent wiring map is authored. IEC labels are descriptive aliases, not separate terminals. S4-J/S4-P socket accessories are excluded.

**Factory net links: none.** NC closure is a switch state, not a permanent jumper. Coil, LED and diode paths also do not merge nets. Required pins 13/14 are operational library policy; contacts remain application-dependent.

## Ratings and representation

Page 55: nominal coil 24 VDC, operating 0.8–1.1 UN (19.2–26.4 V), DC consumption 1.4 W; coil table 414 ohm/58 mA. Contacts: 10 A at 250 V AC-1 or 30 V DC-1, 2500 VA AC, 30 A inrush for 20 ms, recommended minimum 10 mA/5 V. Figure 3 applies separate DC-1 and inductive L/R 40 ms limits at higher voltages. These conditional capabilities stay in notes; only the coil receives nominal-voltage metadata.

The model uses one coil and eight NC/NO functions with shared physical commons and coil-actuation relations. All external connections have supported circuit symbols. Internal LED/diode topology is documented but abstracted in the coil symbol; no semiconductor simulation or transfer timing is claimed. Connection coverage is complete for the bare relay. No essential evidence remains unresolved. Central verification is left to the coordinator; no test project, install, build or repository test was run.
