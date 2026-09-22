# `@thermite/core-library`

Requires Node.js `^22.12.0 || >=24`: use Node 22.12 or a supported later
release. Node 23 is excluded.

This private Thermite Schematics 0.2.0 package contains the shipped electrical component
library `core@0.1.0`, its fixed ordinary-file inventory, and deterministic resolver
metadata. It is bundled inside the private CLI artifact and is not independently
published to a public registry.

Projects select the shipped library only with a name/version dependency that omits
`path`:

```json
{ "name": "core", "version": "0.1.0" }
```

The compiler resolves that exact pair from the installed package. It records stable
display paths rooted at `@thermite/core-library`, resolution kind `shipped`,
and internal lock/IR locator `ais-shipped:core@0.1.0`. The locator is provenance,
not an authored path or registry address.

Any dependency with an explicit `path` is local, including one named `core` or one
whose path text resembles the internal locator. A user-authored local library keeps
its manifest in `library.json`, keeps declared type sources below that directory,
uses an explicit portable relative path from `system.json`, and runs `thermite lock`
after its bytes change.

The package's positive content boundary is its compiled resolver entry point,
`library/library.json`, the declared JSON files below `library/types/`, this
README, and the proprietary license. It performs no npm, network, environment,
`NODE_PATH`, cwd-ancestor, or user-cache discovery.
