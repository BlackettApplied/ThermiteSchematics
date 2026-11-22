# RM1 minimal loads regression

This is the reviewer's minimal core-only conveyor reproduction: SRC1 → Q1 → K1
→ OL1 → M1; PS1 is fed from Q1 and supplies PLC1; PLC1.DO0 drives the K1 coil
through OL1.95/96. It exercises the frozen brief's power, actuation and PS1 loads
view deliverables, not every conveyor operator or field device. The complete RM1
capability mapping remains in PR.md. Hardware suitability is unselected.

The generic PLC's L+/M declare DC class, with no voltage magnitude. They do not
inherit plc-compact's 24 V rating. The project uses only core 0.2.0 types.

```sh
bun thermite.mjs validate packages/core-library/test/fixtures/rm1 --json
bun thermite.mjs view M1 --power --project packages/core-library/test/fixtures/rm1 --json
bun thermite.mjs view K1 --actuation --project packages/core-library/test/fixtures/rm1 --json
bun thermite.mjs view PS1 --loads --project packages/core-library/test/fixtures/rm1 --json
```

Validation reports I305/info for four connected nets with one comparable
voltage-rated terminal and no potential voltage facts (SRC1.L1/L2/L3 and
K1.A1). It identifies no supply path; author intent only from known design facts.

All three view requests render in both flows. The DC class fixes the earlier
PLC1.supply R003 without inventing a voltage magnitude.
