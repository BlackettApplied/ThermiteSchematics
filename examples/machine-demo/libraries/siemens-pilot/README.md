# Siemens pilot library

Three exact order numbers are modeled from manufacturer documents. This is a
small reviewed-by-source pilot, not Siemens certification or a family-wide
catalog. See each type's `catalog.document` and `catalog.modelingNotes` for the
terminal evidence and exclusions. Manufacturer PDFs are linked, not redistributed.

- CPU 1212C DC/DC/DC, 6ES7212-1AE40-0XB0: physical connector pin tables, 8 DI,
  6 DQ, 2 AI, separate supply/common/functional-earth terminals.
- ET 200SP DI 8x24VDC ST, 6ES7131-6BF01-0BA0: terminals 1-8 map to DI0-DI7;
  terminals 9-16 are sensor supplies on the documented BaseUnit arrangement.
- ET 200SP DQ 8x24VDC/0.5A ST, 6ES7132-6BF01-0BA0: terminals 1-8 map to
  DQ0-DQ7; terminals 9-16 are returns on the documented BaseUnit arrangement.

The ET 200SP terminal figures were visually checked against pages 13 of the
02/2019 manuals. CPU terminals were checked against the V20 table 6 on
September 6, 2026. The base units, backplane distribution, interface modules and
network are outside this first library model. Their required selection must be
completed for an actual installation. No implicit internal net joins are made.

Use an explicit relative path in the project's `system.json`, then run
`thermite lock <project>`. All library JSON remains visible. For new types, the
explicit `thermite:io-module`, `thermite:terminal-strip` and `thermite:dc-supply`
symbol profiles support the documented function shapes; other shapes are
explicitly unsupported. Unknown type names never imply electrical behavior.
