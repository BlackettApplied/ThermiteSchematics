# Releco S7-C — s7-c

Decision: **candidate with partial connection coverage**. The exact S7-C main interface supports sixteen modeled endpoints and eight fixed clamp-to-mating paths. The original proposal's complete-coverage claim is corrected because the manufacturer also depicts electrical accessory receptacles belonging to the bare socket.

## Exact source and visual evidence

Manufacturer [ComatReleco World of Relays 3.2](https://www.comatreleco.com/media/43/fd/6f/1692802495/wor_3-2_en.pdf), English, physical/printed **p.354**, identifies **S7-C** as an eight-pin C7 relay socket with screw terminals and RC-suppressor compatibility. No S7-M or other adjacent socket inventory is substituted.

Visually inspected the full exact page and enlarged wiring/dimension drawings. Also inspected only the applicable **S7-BB** row on p.380 and **RC0047-100** row on p.383 to resolve this socket's accessory-interface scope. The local manufacturer PDF and rendered pages are under `references/`; `wor32-p354-diagrams-432dpi.png` preserves the wiring diagram and top-view context.

## Eight main ways

| Main way | Fig.1 relay-function label | Meaning with the illustrated relay fitted |
| -------- | -------------------------- | ----------------------------------------- |
| 1        | 12                         | Pole 1 NC                                 |
| 2        | 22                         | Pole 2 NC                                 |
| 3        | 14                         | Pole 1 NO                                 |
| 4        | 24                         | Pole 2 NO                                 |
| 5        | 11                         | Pole 1 common                             |
| 6        | 21                         | Pole 2 common                             |
| 7        | A1                         | Coil connection                           |
| 8        | A2                         | Coil connection                           |

`C.1`–`C.8` are authoring aliases for the wire clamps; `M.1`–`M.8` are the distinct main relay mating contacts. The eight one-to-one fixed paths `C.n`–`M.n` are retained. No bare-socket coil or changeover function is created from the relay circuit drawn in fig.1. No main terminal is universally required, and metadata alone does not merge nets.

These IEC function labels are diagram assignments, not proof of identical body printing. In the top-view dimension drawing, main way **6 is labeled B1**, whereas the illustrated two-changeover relay uses **6 (21)**. The same physical way may carry an application-dependent function; this does not create another terminal or alter its fixed clamp-to-mating path. The original statement that all diagram function labels were established physical markings was too strong.

## Accessory contacts and partial scope

Fig.1 explicitly draws **three accessory receptacle symbols branching from 8/A2** and **one branching from 7/A1**. These are outside the eight main relay mating positions. The socket therefore has accessory interfaces even when no accessory is installed.

Fig.2 identifies an **S7-BB** attachment beside the coil-side terminals. The p.380 product-reference row explicitly calls S7-BB an A2 connector for **S7-C** and S7-IO; its less inclusive heading names S7-IO and S7-GR. The exact S7-C drawing and product-reference row establish applicability without relying on that heading. Page 383 explicitly lists **RC0047-100/AC250V** for S7-C and pictures its two leads.

The diagrams establish these accessory electrical points and their A1/A2 membership, but do not unambiguously assign all four schematic receptacles to physical openings, printed markings or the respective bridge/suppressor positions. They are documented here as omitted interfaces, without invented pin names, physical orientation or imported S7-M numbering. The corrected type therefore remains a useful **partial** model of the eight main ways.

The optional S7-BB connects A2 points across separate sockets only when fitted. It is not a factory link joining separate socket objects. An RC suppressor is an impedance across coil supply and must not become an A1–A2 fixed jumper. No optional accessory or relay is assumed installed. CP-07B and S9-G are mechanical accessories, distinct from the electrical bridge and suppressor interfaces.

No PE, shield, communication or additional bonding terminal is identified in the opened exact S7-C drawings. PA/PC housing material does not prove an exhaustive absent-interface inventory or an installed bonding path.

## Ratings and remaining uncertainty

Exact p.354 socket capability is **10 A**, or **16 A for one pole**, at **250 V**; the operating range is −40 to +60 °C, with **+50 °C at 16 A**. Preserve these conditions as notes. The corrected candidate removes borrowed relay switching ratings and does not assign nominal-voltage, current-limit or AC-only terminal metadata.

Remaining questions are the physical mapping of accessory contacts, any further bonding interface, and installed relay/accessory configuration and hardware revision. The original main terminal inventory, conformance fixed links and required-key list remain unchanged. `review-inputs.json` records original file hashes; copied job/schema are byte-identical. No author or canonical file was edited, and no tests, build or central verification were run.
