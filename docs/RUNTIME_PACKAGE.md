# Build and verify a runtime package

Users download a runtime ZIP, install Bun 1.4.2 separately, and run
`bun /path/to/runtime/thermite.mjs`. They do not need Git, a dependency install,
or a build. Choose the archive matching the operating system and CPU architecture;
see [platform checks](PLATFORMS.md). Electrical projects live in separate folders
and use the same JSON format as source users.

## Produce a candidate

From a clean committed checkout with Bun 1.4.2 on the target platform:

```sh
bun run package:pack
```

The packer snapshots the exact Git commit into a temporary directory, installs
with the frozen Bun lock and disabled lifecycle scripts, and builds from scratch.
It installs production dependencies separately and materializes the workspace
packages as ordinary directories. The runtime includes compiled JavaScript,
matching TypeScript for source-map debugging, templates, schemas, the core
library, fonts, and complete dependency packages with licenses. It excludes
build caches, development dependencies, the Git repository, and ignored private
working data. The root lockfile is included for provenance; consumers do not
install from it.

Before any artifact is copied to `release-out/runtime/`, the packer verifies it.
Each candidate directory contains:

- A versioned `thermite-<version>-<target>-bun-<commit8>.zip`.
- A `.zip.sha256` sidecar covering the exact ZIP bytes.
- A `.zip.json` copy of the runtime manifest inside the ZIP, recording source
  identity, dependencies, license locations, and payload hashes.
- `verification.json` with the artifact digest and completed acceptance checks.

Existing candidate directories are never overwritten. The package version comes
from the built CLI. Internal workspace versions remain private implementation
identities. Identical payloads use sorted ZIP entries and fixed file timestamps.
This command creates local artifacts only; it does not publish a release.

For changes that have not been committed, use:

```sh
bun run package:pack --preview
```

A preview copies Git-tracked and unignored new files, builds in isolation, and
records an aggregate source-file digest and the base commit. Its filename and
manifest mark it as a preview. **Never publish a preview as a release.** Commit
reviewed changes and generate a clean candidate before publication.

## Recheck the actual download

Keep the ZIP and its sidecar together, then run from a source checkout
(`commit8` is the first eight characters of the source commit and `target` is
for example `darwin-arm64`, `win32-x64`, or `linux-arm64`):

```sh
bun run package:verify /absolute/path/to/thermite-<version>-<target>-bun-<commit8>.zip
```

Standalone verification rejects previews unless `--allow-preview` is explicitly
added for local testing. It checks the filename against the manifest identity.
The verifier checks the sidecar, safe ZIP paths, the exact file inventory and
hashes, dependency license references, and required runtime assets before use.
It extracts into a fresh temporary directory and relocates the runtime to a path
containing spaces. Consumer commands use an empty home/cache, no
Node/npm/npx/Git/build tools on PATH, and read-only package files. On macOS the
consumer runs in a network-denying sandbox. Linux acceptance uses Docker
`--network=none` via `bun run check:linux`. Native Windows verification has no
network sandbox; its report records `networkIsolation: "not-enforced"`. Read this
field before making any offline-isolation claim. It checks:

- Version/help, both initialization templates, refusal to overwrite a project,
  validation, core-library notices, and spare-conductor queries.
- Repeatable SVG, HTML and PDF output, fonts, a BOM export, and diagnostics.
- All six agent commands with separate result/report streams; guarded patch
  dry-run, apply, and rejection of a stale integrity guard.
- Unchanged runtime file bytes after use.

During packaging, the verifier additionally compares SVG, HTML and PDF bytes
against the isolated source build using the same electrical project. A standalone
verification has no source build to compare, and its report reflects that.

## Publish and upgrade deliberately

After repository review and the public release checklist, publish the clean
candidate ZIP, SHA-256 sidecar, manifest and verification report together in a
versioned GitHub Release. Include Bun 1.4.2, each verified operating system and
architecture, the exact source commit, and third-party source availability
instructions in the release notes. Build and verify each target on that target;
the packer does not cross-compile or establish support for untested systems.
The SHA-256 detects changed bytes; it is not a signature authenticating a publisher.
Download the published assets and run the verifier again before announcing them.
The historical private release workflows are separate and must not be repurposed.

The README contains separate agent prompts for runtime users and source
contributors. Runtime users extract upgrades into new folders and deliberately
switch their invocation path. No installer modifies existing projects or replaces
an older runtime. Engine fixes belong in a separate source checkout and focused PR.
