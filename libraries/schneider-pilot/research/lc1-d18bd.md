# lc1-d18bd — Schneider LC1-D18BD

Decision: **candidate**, with **partial physical connection coverage**.

The job spelling LC1-D18BD is retained in the proposed catalog identity. Schneider spells the order **LC1D18BD**. Treating the hyphen after LC1 as a presentation separator is supported by the exact product sheet and B8 selection (LC1D18 plus BD), matching every historical description attribute; no successor or suffix substitution is proposed.

## Evidence

- **S1:** [Schneider Product data sheet, LC1D18BD](https://controltechappfiles.blob.core.windows.net/appfiles-public/documents/datasheet/schneider/LC1D18BD.pdf), dated **May 7, 2019**, PDF pp. 1–3, 6. Manufacturer-authored document at a distributor document mirror. Saved as `references/lc1d18bd.pdf`. Exact identity, ratings, screw clamps, integral suppression and circuit. Visually inspected full p. 6 and its enlarged diagram (clip 40,160,150,230 at 600 DPI).
- **S2:** [Schneider TeSys D, SK, K, SKGC, GC, GY, GF Contactors, Chapter B8](https://iportal2.schneider-electric.com/Contents/docs/B8_CONTACTORS_EN_CATALOGUE.PDF), undated chapter; cover and **B8/8 (PDF 8)** inspected visually. Saved as `references/b8.pdf`; URL redirects to iportal.se.com. Exact LC1D18 row selects three poles and two factory auxiliaries; BD is 24 V DC standard consumption. Applicable DC range specifies integral bidirectional peak-limiting diode suppression. No dated revision visible on reviewed pages.
- **S3:** [Schneider FAQ FA121938, Are the TeSys LC1D DC coils polarity sensitive?](https://www.se.com/us/en/faqs/FA121938/), published 2007-08-28, modified 2026-05-12; opened whole answer. Applies to LC1D***D: A1 positive, A2 negative. Follow this explicit wiring instruction even though S2 describes a bidirectional suppressor.

## Independently observed circuit inventory

| Function          | Terminal markings | De-energized state                 |
| ----------------- | ----------------- | ---------------------------------- |
| Coil              | A1, A2            | 24 V DC, A1 positive / A2 negative |
| Main pole 1       | 1/L1, 2/T1        | Open                               |
| Main pole 2       | 3/L2, 4/T2        | Open                               |
| Main pole 3       | 5/L3, 6/T3        | Open                               |
| Factory auxiliary | 13/NO, 14         | Open                               |
| Factory auxiliary | 21/NC, 22         | Closed                             |

The dotted actuation line is mechanical. No permanent net joins are established by contacts, coil or suppression. Thus the conformance fixed-link inventory is empty. All six functions have existing circuit symbols. Coil supply connections are required for operation; individual main/auxiliary contacts are application-dependent.

## Ratings and scope

S1: main contacts 18 A AC-3 or 32 A AC-1, each at ≤440 V and ≤60 °C; 7.5 kW at 380–400 V AC, 50/60 Hz, AC-3. Coil consumption 5.4 W at 20 °C. These conditional capabilities stay in notes, not scalar contact voltage/current fields. Only the actual 24 V DC coil receives nominal-voltage metadata.

All documented circuit endpoints are represented, including factory auxiliaries. The schematic is not a physical access-point drawing: duplicated coil access, suppressor attachment contacts and any continuity among duplicate access points remain unresolved. Coverage is partial; no extra pins or links are invented. No PE, shield or communication connection is identified in the reviewed circuit. Optional add-on blocks are outside this order. Integral suppression is recorded in notes; the supported coil symbol does not depict its internal semiconductor circuit.

The supplied B8 URL failed in the web PDF opener but downloaded successfully through research-tools.py. No essential circuit evidence is missing. The coordinator must perform central verification; no bespoke project, install, build or repository tests were run.
