# la-dn22 — Schneider LA-DN22 / LADN22

Decision: **candidate, complete coverage of the documented bare contact block**. Independent review resolved the original numbered-diagram gap using a later page of the author's existing manufacturer catalogue and the exact product illustration. The eight terminal keys and their four contact pairs are unchanged. Internal mechanical ganging is now recorded without electrical fixed links.

## Exact identity and source scope

Schneider uses **LADN22** in its catalogue and **LA DN22** in instruction sheet HRB33724. These are formatting variants of the same plain order; **LADN22G** is a separately identified order with different terminal marks.

The current exact product sheet explicitly lists TeSys F **LC1F/CR1F** compatibility alongside TeSys D. Instruction sheet HRB33724 p.7 lists **LA DN22 = 2 F + 2 O**, with F and O defined as NO and NC. No host coil, main contactor terminal or host earthing connection is included in this bare-block model.

## Recovered numbered diagram and actual markings

The manufacturer-authored [TeSys D catalogue 2017](https://docs.rs-online.com/64d6/0900766b815d84a0.pdf), at the identified RS distributor mirror, contains an exact scheme on **physical/printed p.41**, drawing **127273.eps**, headed **2 N/O + 2 N/C LAD N22**. Page 10 provides the corresponding exact selection row. The same p.41 separately labels the G variant with its different numbers, preventing a family-diagram substitution.

Visually inspected the full p.41 context and the enlarged exact LAD N22 scheme (`references/tesys-d-catalogue-p41-ladn22-432dpi.png`). It establishes:

| Left-to-right contact | Unactuated state | Terminal pair |
| --------------------- | ---------------- | ------------- |
| 1                     | NO               | 53–54         |
| 2                     | NC               | 61–62         |
| 3                     | NC               | 71–72         |
| 4                     | NO               | 83–84         |

The [exact LADN22 product PDF](https://www.se.com/us/en/product/download-pdf/LADN22), saved footer **2026-09-13** and originally retrieved 2026-09-12, provides direct physical-marking corroboration on **p.1**. Its illustration is labeled **LADN22**, with top-row **53NO, 61NC, 71NC, 83NO** and bottom-row **54NO, 62NC, 72NC, 84NO**. These marks were visually inspected in `references/ladn22-se-us-p1-front-432dpi.png`. Page 5's dimensions show the eight terminal wells, but the identity, diagram and legible product markings provide the stronger evidence.

The official [FAQ FA130288](https://www.se.com/us/en/faqs/FA130288/) was independently opened and saved. It confirms the same four pair assignments and explicitly distinguishes LADN22G. Its publication date is 2010-02-28 and displayed modification date is 2026-08-15. The FAQ remains a text source (`diagramReviewed: false`); the catalogue and product illustration supply the visual evidence. Distributor product summaries are unnecessary.

## Mechanical coupling and electrical separation

The exact LAD N22 scheme depicts a common mechanical linkage across its four contacts. Three `ganged_with` relations connect the existing contact functions, describing the shared mechanism only. They do not create a common electrical node, claim identical switching instants or connect to a modeled host coil. The source product data sheet specifies a 1.5 ms NC/NO non-overlap on energization and de-energization.

All four electrical contact circuits remain separate; `fixedLinks` stays empty. In particular, the normal closed state of 61–62 or 71–72 is not a permanent jumper. Contacts remain application-dependent, with no universally required terminal. The existing generic NO/NC symbols are retained.

## Ratings and coverage

Conditional ratings remain notes: Ui 690 V IEC / 600 V UL-CSA; Ie 6 A at 120 V AC-15, 1.04 A at 690 V AC-15, 0.55 A at 125 V DC-13 and 0.1 A at 600 V DC-13; Ith 10 A at 60 °C; minimum switching 5 mA / 17 V. No nominal-voltage or current scalar is assigned, and the contacts are not marked AC-only.

The exact scheme and physical illustration now establish the eight electrical connections of the documented plain LADN22. The former partial-coverage reason is resolved. No separate PE, shield or communication connection is identified for this block; the host is outside scope. The specific historical installed hardware revision remains unverified, which is an as-built applicability limitation rather than a missing terminal in the documented component.

## Other retained primary source and provenance

[Schneider instruction sheet HRB33724](https://download.se.com/files?p_enDocType=Instruction+sheet&p_File_Name=HRB33724.pdf&p_Doc_Ref=HRB33724), 07/2012, p.7 exact adder-block list, was visually inspected and copied alongside the other source PDFs. It supports spelling/composition and LC1-F application, not the terminal-number diagram.

`review-inputs.json` records both original-author and reviewed-stage hashes, plus local source hashes. `job.json` and `candidate.schema.json` are exact copies matching both directories. No original, reviewed-stage, index or canonical file was changed. No tests, build, central verification or promotion was run.
