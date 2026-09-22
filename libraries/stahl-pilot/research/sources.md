# STAHL source and review record

Reviewed 2026-09-11. Manufacturer-authored documents support each fact below.
Mirror provenance is explicit. The original PDFs are retained only in local
research scratch, not distributed with this library.

| Document                                                                                                                                                                    | Revision and reviewed pages                                                                                            | Use                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| [8527 operating instructions](https://r-stahl.com/fileadmin/tx_aimeos/Files/1_/02/0000000000000008527602300_001_02/Istruzioni_per_l_uso_8527602300_001_02.pdf)              | 147234 / 8527602300; 2013-03-06 BA00 III en 02. English pp.6–8,11; PDF 32–34,37.                                       | Main terminals 1/2,3/4,5/6; protective-conductor requirement; conditional ratings and termination limits. Diagram 11530E00 visually checked. |
| [8527 historical catalog](https://mega-ex.com/product_hazardous/Electrical%20Equipment/STAHL/10012015.pdf)                                                                  | Undated manufacturer catalog, distributor mirror; printed 10/12–10/15. Selection table 10/13, PDF 2, visually checked. | Exact 8527/21-11-0001 at 9–12.5 A with no accessories, ammeter or auxiliary contacts.                                                        |
| [8570/11 operating instructions](https://r-stahl.com/fileadmin/tx_aimeos/Files/1_/05/0000000000000008570601300_001_05/Betriebsanleitung_8570601300_001_05.pdf)              | 150646 / 8570601300; 2014-04-08 BA00 III en 05. English pp.6–12; PDF 24–30.                                            | Socket switching, contact arrangement and protective-conductor requirement; PDF 26,29,30 visually checked.                                   |
| [8570/11 manufacturer catalog](https://www.rstahl.hu/uploads/8570-11-adatlap.pdf)                                                                                           | 24.03.2019 PO en; PDF 2–3.                                                                                             | Exact 8570/11-306, article150578; base variant excludes auxiliary contacts present on the separate S001 variant.                             |
| [8570/11 and /12 instructions, Italian](https://r-stahl.com/fileadmin/tx_aimeos/Files/1_/03/0000000000000008570618300_001_03/Manual_de_instrucciones_8570618300_001_03.pdf) | 8570618300; 31/01/2007. pp.5–8,10–12,14.                                                                               | Legacy plug family and three-pole protective cap 8570001140. Exact cap row p.14 visually checked; excludes extra-low-voltage plugs.          |
| [6036 accessory table](https://r-stahl.com/fileadmin/tx_aimeos/Files/n_/gb/SDS_PV_227433_en_GB.pdf)                                                                         | 2019-10-25 V0.108 EN, p.5.                                                                                             | Exact accessory identity 8570/12-306, article 150579, three poles,200–250 V AC,50/60 Hz,16 A. No luminaire data is applied to the plug.      |
| [8575/13 and /14 instructions](https://r-stahl.com/fileadmin/tx_aimeos/Files/1_/01/0000000000000008575618300_001_01.pdf)                                                    | 8575618300; 11/04/2007. English pp.3–7, PDF 14–18.                                                                     | Coupler's interlocked switching, two power contacts plus PE, cable terminations; PDF 16,18 visually checked.                                 |
| [8575/14 manufacturer catalog](https://r-stahl.com/fileadmin/tx_aimeos/Files/i_/en/8575_14_Couplers_EK00_III_en.pdf)                                                        | 2014-04-08 EK00 III en, E3/2 / PDF 2.                                                                                  | Confirms exact 8575/14-306,200–250 V,50/60 Hz,16 A,blue,6h. The source number is valid and is not rewritten to 8572/14.                      |

## Differences that remain open

- The 2007 coupler manual says only8575/12 plugs may be used; the 2014 catalog
  and later 8570 literature must be reconciled for the intended hardware revision
  before asserting cross-series compatibility. The example never mates the
  8570 plug to the 8575 coupler.
- Coupler ingress ratings differ: the 2007 manual's English p.4 gives IP66 and
  IP55 with a plug inserted; the 2014 catalog gives IP54. The model records the
  latter catalog value only as a dated claim and makes no installation ingress
  certification.
- Connector function labels do not reproduce verified physical pin numbering.
  In particular, generic 2P+PE data does not prescribe the circuit's L/N use.
- The breaker manual mandates PE but does not resolve the full physical PE
  screw inventory used by the historical unit. Its model remains partial.
- Modern 8570/12-306 article 257780 is not substituted for the legacy article
  150579 documentation. Same-order revisions need hardware comparison.

The historical 8575 catalog establishes the exact identity. Component suffixes
require separate review before modeling a complete operator assembly.
