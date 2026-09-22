# Evidence and revision boundaries

Reviewed 2026-09-11. Manufacturer circuit diagrams were visually inspected for
each exact order, independently of the initial research summary. These records
establish catalog identities, not installation in any particular machine.

## Primary catalog

[Phoenix Contact CLIPLINE complete, part 1](https://www.phoenixcontact.net/catalog/downloads/CLIPLINE_1_EN.pdf),
2011, 608 PDF pages.
Hardware revision is not stated; the definitions are bounded to this document.

| Model   | Printed page / PDF page  | Verified facts                                                                                                    |
| ------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| 3031306 | 161 / 163, middle column | ST 2,5-QUATTRO gray order; four clamps on one bar; nominal IEC 800 V and 24 A at 2.5 mm2; maximum 28 A with 4 mm2 |
| 3031319 | 161 / 163, middle column | ST 2,5-QUATTRO BU blue order; same column and ordinary four-clamp topology                                        |
| 3036356 | 189 / 191, left column   | ST 2,5-TWIN-MT order; two clamps common on one side, one across the knife; diagram open; nominal IEC 400 V, 20 A  |
| 3036149 | 147 / 149, left column   | ST16 gray order; two clamps on one bar; nominal IEC 1000 V, 76 A at 16 mm2; maximum 90 A with 25 mm2              |

QUATTRO and TWIN-MT accept solid conductors 0.08-4 mm2, stranded conductors
0.08-2.5 mm2 and ferruled conductors 0.14-2.5 mm2. The cited catalog specifies
10 mm stripping. ST16 accepts solid 0.2-25 mm2, stranded 0.2-16 mm2 and ferruled
0.25-16 mm2 conductors, with 18 mm stripping. Maximum block load must respect the
total current of connected conductors. Accessory bridges have separate ratings.

Only the nominal IEC capability is encoded in `rating`. UL/CSA/Ex values are
different, conditional approval data and are not substituted or aggregated.
The library does not make a hazardous-area system assessment.

## Independent manufacturer extracts

The following historical documents identify Phoenix Contact as author; their
download hosts are distributor mirrors. They corroborate topology and distinguish
revisions. Source PDFs remain outside the repository.

| Exact order | Manufacturer catalog extract                                                                                  | Diagram                                                           |
| ----------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 3031306     | [July 22, 2011, six pages](https://datasheet.octopart.com/3031306-Phoenix-Contact-datasheet-33585281.pdf)     | p.5: four wire clamps, two accessory points on continuous bar     |
| 3031319     | [May 1, 2009, four pages](https://media.onlinecomponents.com/productfiles/mf-PH/phoenix_3031319_1.pdf)        | p.3: same ordinary four-clamp topology                            |
| 3036356     | [January 26, 2010, four pages](https://media.onlinecomponents.com/productfiles/mf-PH/phoenix_3036356_1.pdf)   | p.3: two common clamps at left, open knife, single clamp at right |
| 3036149     | [September 30, 2009, four pages](https://media.onlinecomponents.com/productfiles/mf-PH/phoenix_3036149_1.pdf) | p.3: two ordinary clamps on continuous bar                        |

The ST16 2009 extract p.2 lists 800 V. The official 2011 catalog instead lists
1000 V for the same order. This model uses the explicitly identified 2011
catalog rating; do not apply that value to unidentified installed stock without
checking its applicable documentation. The extracts also contain approval-table
and dimension differences from the 2011 catalog; those are not merged into a
synthetic variant.

The TWIN-MT diagram is open in both reviewed documents. Describing the knife as
intrinsically normally closed would overstate the evidence. `normal_state: open`
is the reference drawing convention used here, not an assertion of its actual
position in an installation.

The larger open circles in the circuit diagrams correspond to the ordinary wire
clamps; the filled intermediate points are accessory bridge positions. This
batch models the former only. It has no PE variant, test-plug inventory, bridge
assembly model or automatically conducting function.

## Current identity cross-checks

The official product pages also identify [3031306](https://www.phoenixcontact.com/en-us/products/multi-conductor-terminal-block-st-25-quattro-3031306),
[3031319](https://www.phoenixcontact.com/en-sg/products/multi-conductor-terminal-block-st-25-quattro-bu-3031319),
[3036356](https://www.phoenixcontact.com/en-us/products/disconnect-terminal-block-st-25-twin-mt-3036356)
and [3036149](https://www.phoenixcontact.com/en-us/products/feed-through-terminal-block-st-16-3036149).
The gray QUATTRO, TWIN-MT and ST16 pages were accessible during this review;
the blue page was not. Blue identity and topology were verified in the downloaded
manufacturer catalog and exact-order extract. Current web data are supporting
identity checks; they do not replace the declared historical source revision.
