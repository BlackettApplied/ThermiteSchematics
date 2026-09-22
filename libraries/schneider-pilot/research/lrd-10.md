# lrd-10 — reviewed LRD10 follow-up

Decision: **candidate**, with ten documented bare-device electrical interfaces and explicit static-model limits. Original worker files remain intact.

The original had correct numeric endpoints, NC 95–96/NO 97–98, unswitched heater prose and no fixed links. Its three `other` functions were bound to `overload`, which the current renderer rejects. They are now three two-terminal **load/heater** functions. A heater is a series sensing impedance; no ideal jumper was introduced. The central compiler continues to derive nets only from explicit conductors. The model does not simulate heating, current, voltage drop, trip timing or reset state.

## Exact identity and evidence

- Manufacturer order **LRD10**, retained source spelling **LRD-10**. The historical Schneider/Telemecanique catalog actually prints **LRD-10, 4–6 A, class 10A** at **printed 2/112 / physical 5**. The worker incorrectly cited2/110, which describes LR9. Corrected references retain the same [Farnell manufacturer mirror](https://www.farnell.com/datasheets/66011.pdf). Its LRD scheme is **printed 2/119 / physical12**, visually reviewed.
- The [official exact current sheet](https://www.se.com/us/en/product/download-pdf/LRD10), generated 2026-09-11, and [exact 2023-04-13 sheet](https://docs.rs-online.com/764c/0900766b816a57ad.pdf), pp. 1–2, confirm 4–6 A class 10A and1 NO + 1 NC. The latter's exact product photo shows three input pins, three load clamps and four auxiliary clamps.
- The [official 2009 TeSys D guide](https://download.schneider-electric.com/files?p_Doc_Ref=S8500CT0901FPR0&p_File_Name=TeSysDtechGuide+S8500CT0901FPR0.pdf&p_enDocType=Catalog) independently confirms LRD10 at printed57 / physical60, the LRD scheme at printed66 / physical69, and controls at printed51 / physical 54.
- [Official PHA4929101-08 instruction](https://download.se.com/files?p_Doc_Ref=PHA4929101&p_File_Name=TeSys-LRDooo-OLR-Instruction-Sheet-PHA4929101-08.pdf&p_enDocType=Instruction+sheet), 02/2024, pp. 1–2, covers LRD01–35 and shows direct mounting, controls and optional accessories. Rotated native PDF crops are retained under references.

## Connections and behavior

| Model endpoints | Physical/function scope                     | Modeled representation                 |
| --------------- | ------------------------------------------- | -------------------------------------- |
| 1–2             | Input pin1 to load clamp2T1 through heater1 | Unswitched load/heater                 |
| 3–4             | Input pin3 to load clamp4T2 through heater2 | Unswitched load/heater                 |
| 5–6             | Input pin5 to load clamp6T3 through heater3 | Unswitched load/heater                 |
| 95–96           | Auxiliary NC                                | Closed reset/nontripped; opens on trip |
| 97–98           | Auxiliary NO                                | Open reset/nontripped; closes on trip  |

Numeric power keys are the applicable manufacturer's **scheme identities**. Upper1/L1, 3/L2, 5/L3 typography is not established as physical inscription; L aliases are documentary only. Do not transfer combined labels from the neighboring LR9 diagram. No installation orientation is inferred. Input pins and load screw clamps are distinct access forms, not six identical clamps. A control clamp's two-wire capacity does not add duplicate terminals.

TEST simulates trip and operates both auxiliary contacts. STOP opens only 95–96, leaving 97–98 unaffected. RESET and manual/automatic selection are mechanical controls without extra terminals. The2024 instruction marks trip test for manual position and includes a caution about the depicted operation while tripped. These behaviors are documented rather than dynamically simulated.

**Fixed links: none.** Actual heater paths remain physically conducting when the relay trips, but a sensing impedance is not an ideal jumper. Separate compiler nets do not claim a physical switching gap. No auxiliary contact, cross-pole link, coil, PE or suppressor is invented. LAD7C1/LAD7C2 prewiring and independent-mount adapters remain separate accessories. No universally required terminals are imposed.

## Limits and preserved conditions

The 4–6 A range does not establish an installed setting. Power capability 690 V AC and conditional auxiliary ratings remain notes; no scalar nominal voltage/current is assigned. Complete connection coverage means the documented ten bare-device interfaces, not verification of an installed historical unit's typography or its surrounding wiring. Series impedance, current, thermal trip and control-state simulation remain outside this static model.

`changes.json` records original and follow-up hashes. Job and candidate schema are exact copies; type/result/research are revised. No canonical edits, central verification, promotion or full tests were run. The original render binding failure is recorded by the coordinator separately.
