# Formats and compatibility

Thermite 0.3.0-alpha.2 supports the formats below through its runtime ZIP and
source workflows. Workspace package versions and original `thermite` interfaces
retain their compatibility identities. These are file and API contracts, not
separate public registry packages.

## Paper and packets

See [view requests, paper and packet contracts](views.md).

## Cable assignments

See [cable assignments and compatibility](cable-assignments.md).

## Libraries and deployment

See [library deployment and output safety](deployment-and-output.md).

## Documentation and library metadata

See [source metadata and documentation contracts](source-metadata.md).

## Compact sheets and references

See [view composition and references](views.md#compact-sheets-and-references).

## PDF and semantic review

See [snapshot, review, watch and PDF](review.md).

## Declared physical continuity review

`continuity-check-request/0.1` is a standalone saved review request, not a project
source extension. `physical-continuity-report/0.1` returns explicit obligations,
resolved endpoint net IDs and model coverage, and satisfied/missing-modeled-path/
indeterminate outcomes. The query API and source-alpha `continuity` command use
only the existing physical net semantics. See [request, exits and limits](continuity-checks.md).
No library or project schema, net derivation or guarded agent contract is changed.
