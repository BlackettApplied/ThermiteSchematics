# Completeness example

This generic example intentionally has unfinished connections and a partial HMI
model. D1.N has a single-ended spare cable core; D2.N contradicts an unused note;
D2.S is required by this application. D1.P is connected but has deferred work.
HMI1 has communication ports and no modeled power connector. D2.SP and HMI1.ETH2
are explicitly unused.

From the repository root:

```sh
node thermite.mjs diagnostics --project packages/cli/fixtures/completeness
node thermite.mjs diagnostics --project packages/cli/fixtures/completeness --device HMI1 --json
```

These generic interfaces demonstrate the feature, not manufacturer pinouts.
