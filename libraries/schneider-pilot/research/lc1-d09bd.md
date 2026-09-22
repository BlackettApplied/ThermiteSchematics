# lc1-d09bd — Schneider LC1-D09BD

Decision: **candidate**, with partial physical connection coverage.

Manufacturer spelling is **LC1D09BD**. The source hyphen is treated as a presentation separator, not a different suffix: the exact Schneider sheet agrees with every distinguishing source attribute, and the catalog explicitly selects LC1D09 plus BD. The proposal preserves `schneider-pilot:lc1-d09bd`, `Schneider Electric`, and `LC1-D09BD`. No successor or accessory is substituted.

Evidence opened and retained locally:

- **S1:** [Product data sheet — LC1D09BD](https://iportal.se.com/Contents/docs/SQD-LC1D09BD.PDF), Schneider Electric, Sep 08, 2017, physical/printed pages 1–3 and 6. Exact identity, coil, contact composition, conditional ratings and screw-clamp connections. Page 6 was visually inspected in full, then enlarged at 600 DPI (PDF rectangle 40,160,150,230). Local `references/lc1d09bd.pdf`, extracted text and page images.
- **S2:** [TeSys D, SK, K, SKGC, GC, GY, GF — Contactors, Chapter B8](https://iportal2.schneider-electric.com/Contents/docs/B8_CONTACTORS_EN_CATALOGUE.PDF), manufacturer-hosted; URL redirects to iportal.se.com. No issue date/revision printed on inspected chapter cover or pages. Visually inspected physical pages 1, 8 and 79, printed B8/1, B8/8, B8/79. B8/8 selects the screw-clamp LC1D09 with one NO and one NC auxiliary; its DC voltage table places BD under 24 V and states integral bidirectional suppression. The corresponding LC1D09–D150 three-pole diagram on B8/79 agrees with S1. Local `references/b8.pdf` and supporting text/images. The web opener failed on the old catalog URL; the provided download helper successfully obtained it.

Independent connection specification (S1 p6, corroborated by S2 B8/79):

| Function          | Manufacturer endpoint marks | De-energized state |
| ----------------- | --------------------------- | ------------------ |
| Coil              | A1, A2                      | 24 V DC control    |
| Main pole 1       | 1/L1, 2/T1                  | NO                 |
| Main pole 2       | 3/L2, 4/T2                  | NO                 |
| Main pole 3       | 5/L3, 6/T3                  | NO                 |
| Factory auxiliary | 13/NO, 14                   | NO                 |
| Factory auxiliary | 21/NC, 22                   | NC                 |

No fixed links: the diagram’s mechanical linkage, NC contact, coil and suppressor do not establish permanent net continuity. All six functions have supported coil/contact circuit marks. A1/A2 are required for the operational contactor abstraction; contact endpoints are application-dependent. Slash labels are preserved, without invented terminal aliases.

Ratings: S1 specifies 9 A AC-3 or 25 A AC-1 at ≤440 V AC, ambient ≤60 °C; 24 V DC coil, 5.4 W at 20 °C. Capability maxima (690 V AC / 300 V DC power circuit) are not nominal circuit assignments. No scalar contact voltage/current is encoded. S1 identifies a built-in bidirectional peak-limiting diode; it is documented within the coil abstraction, not drawn as a separate suppressor or short circuit. No polarity marking appears on the reviewed circuit diagram.

Remaining limit: twelve distinct schematic endpoints are established, but physical duplicated coil access and any associated factory links are not resolved. Coverage is explicitly partial; no guessed duplicate points, PE, shield, ports or optional contact-block terminals are added. No source/manufacturer disagreement beyond spelling was found. No installs, builds, repository tests or bespoke fixture were run; central verification is deferred to the coordinator.

## Coordinator evidence follow-up

Schneider FAQ FA121938 (published2007-08-28, modified2026-05-12; https://www.se.com/us/en/faqs/FA121938/) explicitly applies to LC1D***D DC coils and instructs A1 positive, A2 negative. This includes LC1D09BD. The absence of polarity signs on the simplified circuit diagram and bidirectional suppressor wording do not establish non-polar wiring. The terminal descriptions now retain these instructions. This change does not resolve duplicated physical access or add any fixed link.
