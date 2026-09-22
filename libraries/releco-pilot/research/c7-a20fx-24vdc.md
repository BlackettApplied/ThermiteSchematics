# Releco C7-A20FX/24VDC — candidate

Source identity: c7-a20fx-24vdc. Proposed type: `releco-pilot:c7-a20fx-24vdc`. Scope is the bare eight-pin relay; no separately ordered socket is included.

## Evidence

**S1:** ComatReleco, _General Catalogue / World of Relays_, **WoR 3.2**, printed and physical PDF pages **10, 11, 69**. Manufacturer-hosted [catalog](https://www.comatreleco.com/media/43/fd/6f/1692802495/wor_3-2_en.pdf). Download: `references/wor-3-2.pdf`; extraction and acquisition metadata alongside it. Full pages 10, 11 and 69 were visually inspected, including page 69's selection table, wiring diagram and pin-face drawing. The wiring diagram was additionally inspected at 400 DPI (clip 395,210,565,280 PDF points).

Page 69 explicitly assigns AgNi to C7-A20 and offers the C7-A2xFX/DC.V row at 24 V. Page 10 explains the voltage field and F/X options; page 11 shows the applicable C2–C9 FX circuit. Thus the manufacturer's configured designation is C7-A20FX/DC24V. Treating source `/24VDC` as the same 24 V DC voltage field is a documented nomenclature interpretation; the source spelling is preserved, with no suffix added or successor substituted. Historical description “QR-C miniature, power, two pole” agrees with the catalog function. No original historical unit revision or as-built socket is asserted.

## Independently established connections

Page 69 figure 1 directly pairs physical pins with IEC function labels:

| Physical pin (model key) | IEC label | Function                          |
| ------------------------ | --------- | --------------------------------- |
| 1                        | 12        | Pole 1 NC                         |
| 2                        | 22        | Pole 2 NC                         |
| 3                        | 14        | Pole 1 NO                         |
| 4                        | 24        | Pole 2 NO                         |
| 5                        | 11        | Pole 1 common                     |
| 6                        | 21        | Pole 2 common                     |
| 7                        | A1+       | Coil positive                     |
| 8                        | A2−       | Coil negative (FX diagram, p. 11) |

Figure 4 shows the numbered terminal face, viewed toward the exposed pins (underside), with 1/2, 3/4, 5/6 and 7/8 rows as drawn. This viewing-side interpretation is based on the pin-face drawing; the catalog does not print a “bottom view” caption. No positional inference is needed for the figure 1 electrical mapping. IEC labels are aliases, not additional terminals. All eight physical Faston 4.75 mm pins are covered; no PE, shield or communication connection is documented for this relay.

Factory net-equivalence links: **none**. Normal-state contacts are 5–1 and 6–2; energized throws are 5–3 and 6–4. These are switching functions, not permanent conductors. Coil, series reverse-polarity diode, free-wheeling diode and LED also do not join nets. Coil pins are required by library policy; contact use is application-dependent.

## Ratings and representation

Page 69 specifies 24 V DC nominal coil selection, operating range 0.8–1.1 Un, and DC consumption 1 W (coil table: 632 ohms, 38 mA). Contact maxima are conditional: 10 A at 250 V AC-1 or 30 V DC-1; 30 A inrush for 20 ms; recommended minimum 10 mA/10 V. Figure 3 supplies DC load derating, including inductive L/R=40 ms. These limits remain notes; no contact nominal voltage or universal switching-current scalar is assigned.

Existing coil and NC/NO symbols represent all external functions, with shared common terminals and coil actuation relations. LED/diode details remain documented within the coil abstraction, not separately rendered semiconductor symbols. No electrical simulation of suppression or transfer timing is claimed.

The standalone manufacturer C7-A2x sheet URL `https://www.comatreleco.com/wp-content/uploads/cr-prod/cr-prod-doc/EN_DAT_CAT_C7-A2x_00001.pdf` returned HTTP 404. The complete manufacturer catalog provided the needed evidence. No essential connection uncertainty remains for this proposed bare-relay abstraction.
