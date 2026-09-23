# Single Executable Application Feasibility and M9 Specification

Status: M8 assessment complete; M9 engineering specification  
Assessment date: 2026-08-28

## Decision

Node single executable application (SEA) packaging is feasible for Thermite Schematics, but
M8 delivers assessment only. M8 does not add a SEA build, esbuild, postject, a signing
action, an executable, or a release asset. The private, deterministic
`thermite-cli-0.2.0.tgz` remains the trusted early-user distribution channel.

M9 may proceed with an unsigned engineering implementation for native `windows-x64`
and `linux-x64`. An unsigned binary is an internal test artifact only. It must not
replace the M8 tarball in an early-user release. A trusted Windows binary remains a
no-go until the user supplies and controls Authenticode credentials. A macOS target is
specified below but is not part of the initial two-target M9 gate; its signing and
notarization credentials are also the user's future responsibility.

This is the M8-D12 decision:

- **M8:** document feasibility and the complete build specification only.
- **M9 engineering:** implement the asset-provider seam, CommonJS bundle, native SEA
  builds, parity tests, reproducibility proof, SHA-256 manifests, SBOM/dependency
  inventory, and internal unsigned-artifact controls.
- **Trusted binary distribution:** begins only after the applicable signing
  prerequisite is satisfied and the post-signing verification gate passes. Until then,
  the signed-binary release gate is deliberately closed.

There is no unresolved release-blocking design question. Missing credentials, failed
parity, failed unsigned reproducibility, an incomplete asset set, or an unsupported
native target has a predetermined result: no binary release, with the M8 tarball
remaining authoritative.

## Supported-LTS evidence

The current package engine is `^22.12.0 || >=24`; Node 23 is excluded. As of the
assessment date, the official [Node release table](https://nodejs.org/en/about/previous-releases)
lists Node 22 and Node 24 as LTS and Node 23 as end-of-life. The SEA facility is present
in both supported lines:

- [Node 22.23.2 SEA documentation](https://nodejs.org/download/release/v22.23.2/docs/api/single-executable-applications.html)
- [Node 24.20.0 SEA documentation](https://nodejs.org/download/release/v24.20.0/docs/api/single-executable-applications.html)

Both documents classify SEA as stability 1.1, active development. Both support one
embedded CommonJS script, preparation-blob assets retrieved through `node:sea`, and
Windows and Linux native executables. They require the Node binary that creates the
preparation blob to be the same version as the binary receiving it. Node 24 currently
tests macOS SEA on arm64, not x64.

The single-script and non-file-based `require()` constraints make a complete bundle
mandatory. The asset API makes the non-code payload feasible. Setting `useSnapshot`
and `useCodeCache` to `false` avoids snapshot/cache platform coupling and the documented
`import()` restriction of code cache. Thermite Schematics additionally requires native builds
even though those options make some cross-platform generation possible; no target may
inject a blob into another platform's Node binary.

## Feasibility findings

The implementation is a good SEA candidate for these reasons:

- All first-party runtime code and the selected third-party runtime closure are
  JavaScript. Thermite Schematics has no native addon in the M8 product closure.
- The renderer imports `elkjs/lib/elk.bundled.js`. That file contains the worker
  implementation used by the renderer; the current render path performs no separate
  ELK filesystem asset read.
- The CLI already exposes one dispatcher and stateless commands. A dedicated M9 entry
  can invoke the same `runCli` function from a CommonJS-compatible async wrapper.
- M8 already records exact first-party, third-party, legal, starter, schema, and core
  bytes. Those authorities can generate a closed SEA asset map without directory
  discovery.
- M8 already proves deterministic JSON, diagnostics, SVG, init, offline installation,
  and tar packaging. The SEA tests can compare against that installed tarball rather
  than inventing a second semantic authority.

The work is not zero-cost. The current package path is ESM, the SEA main must remain a
single CommonJS script until the supported LTS contract is revalidated, and several
runtime assets are addressed through package-relative filesystem paths. Those are M9
implementation tasks, not feasibility blockers.

## M8 asset-loading audit

The audit covered the committed M8 product and Task 6 inventories. Project manifests,
project source, presentation, lock, and explicit local-library files are user data and
must remain ordinary filesystem inputs. The future provider owns only immutable
Thermite Schematics package assets.

| Asset class                         | Implemented M8 path                                                                                                                                                                                                                          | Finding for M9                                                                                                                                                                                                                                                                                         |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Agent guide                         | `scripts/copy-agent-guide.mjs` copies root `AGENTS.md` to `packages/cli/assets/AGENTS.md`; `thermite init` resolves the CLI package root from `import.meta.url`, then `lstat`s and reads the asset.                                                | The two committed guide files are byte-identical. Replace only the package-root lookup with provider key `cli/assets/AGENTS.md`; preserve the exact bytes and INIT005 failure mapping.                                                                                                                 |
| Starter templates                   | `STARTER_TEMPLATE_PATHS` fixes six paths under `packages/cli/templates/starter-default`; `thermite init` reads all six before preparation, validates them, and regenerates the lock.                                                               | The exact path tuple is already suitable for a closed provider inventory. Preserve token-splice behavior, output bytes, validation, and ordered reads.                                                                                                                                                 |
| Canonical schemas                   | Normal compilation derives `packages/schema/schemas` from `import.meta.url`, enumerates `*.schema.json`, and reads 15 files. Init separately uses the generated `IN_MEMORY_CANONICAL_SCHEMAS` registry and performs no schema discovery I/O. | Normal compilation needs provider-backed exact-key reads instead of `readdir`. Keep the init in-memory path unless M9 proves the replacement preserves every M8 call/diagnostic contract. Provider-loaded and generated registries must deep-equal.                                                    |
| Shipped core                        | `resolveShippedCoreLibrary()` derives the core package root from `import.meta.url`. Normal loading reads the library through the filesystem loader; init reads the exact 14-entry `SHIPPED_CORE_FILE_INVENTORY`.                             | Add an asset-backed shipped-library input that produces the same raw bytes, stable display paths, locator, hashes, lock verification, and IR provenance without materializing files. Explicit local libraries remain filesystem-backed and unchanged.                                                  |
| Proprietary and third-party notices | Task 6 stages root `LICENSE`, the byte-identical core-library `LICENSE`, generated `THIRD_PARTY_LICENSES.json`, and one license file for each of 26 third-party packages.                                                                    | Embed these legal bytes from the Task 6 authorities and include them in the SBOM/dependency inventory. They are not executable code and must never be read from the host installation path in SEA mode.                                                                                                |
| ELK runtime                         | Renderer code imports `elkjs/lib/elk.bundled.js`; the M8 third-party inventory also contains `main.js`, `elk-api.js`, worker files, and declarations for the package distribution.                                                           | The SEA bundle must include the actually reached bundled implementation. The esbuild metafile and runtime-closure audit must show no separate ELK asset read. If a later ELK edge becomes data rather than bundled code, the build must fail until that exact byte is added to the provider inventory. |

### Closed runtime asset keys

M9 must define one code-unit-sorted `PackagedAssetKey` inventory. The filesystem and
SEA providers must expose exactly the same keys and SHA-256 values, reject a missing,
extra, duplicate, or unknown key, and return a fresh `Uint8Array` for each read.

The six starter keys are:

```text
cli/templates/starter-default/connections/control-power.json
cli/templates/starter-default/devices/equipment.json
cli/templates/starter-default/electrical-system.lock.json
cli/templates/starter-default/potentials/potentials.json
cli/templates/starter-default/presentation.json
cli/templates/starter-default/system.json
```

The guide key is:

```text
cli/assets/AGENTS.md
```

The 15 schema keys are:

```text
schema/schemas/cable-type.schema.json
schema/schemas/cable.schema.json
schema/schemas/common.schema.json
schema/schemas/device-type.schema.json
schema/schemas/device.schema.json
schema/schemas/jumper.schema.json
schema/schemas/library-file.schema.json
schema/schemas/library-lock.schema.json
schema/schemas/library.schema.json
schema/schemas/potential.schema.json
schema/schemas/project-presentation.schema.json
schema/schemas/project.schema.json
schema/schemas/relation.schema.json
schema/schemas/source-file.schema.json
schema/schemas/wire.schema.json
```

The 14 core keys are the existing production inventory with a `core/` prefix:

```text
core/library/library.json
core/library/types/breaker-3p.json
core/library/types/cable-2pair-shielded.json
core/library/types/contactor-3p-1no.json
core/library/types/junction-box-8.json
core/library/types/limit-switch-2wire.json
core/library/types/motor-3ph.json
core/library/types/overload-3p-1nc.json
core/library/types/plc-compact.json
core/library/types/prox-pnp-3wire.json
core/library/types/psu-24vdc.json
core/library/types/pushbutton-nc.json
core/library/types/supply-480v-3ph.json
core/library/types/terminal-block-8.json
```

Legal keys are `legal/LICENSE`,
`legal/@thermite/core-library/LICENSE`,
`legal/THIRD_PARTY_LICENSES.json`, and the exact 26 `role: license` file rows from
`scripts/release-third-party-stage-files.json`, mapped by removing the leading
`package/` and prefixing `legal/`. The two first-party license keys intentionally have
the same bytes. This gives 65 initial embedded keys: 36 runtime semantic assets and 29
legal assets. The committed Task 6 inventories, rather than a manually repeated digest
list, remain the byte authority.

The 26 mapped third-party legal keys are:

```text
legal/node_modules/@nodelib/fs.scandir/LICENSE
legal/node_modules/@nodelib/fs.stat/LICENSE
legal/node_modules/@nodelib/fs.walk/LICENSE
legal/node_modules/ajv/LICENSE
legal/node_modules/braces/LICENSE
legal/node_modules/commander/LICENSE
legal/node_modules/elkjs/LICENSE.md
legal/node_modules/fast-deep-equal/LICENSE
legal/node_modules/fast-glob/LICENSE
legal/node_modules/fast-uri/LICENSE
legal/node_modules/fastq/LICENSE
legal/node_modules/fill-range/LICENSE
legal/node_modules/glob-parent/LICENSE
legal/node_modules/is-extglob/LICENSE
legal/node_modules/is-glob/LICENSE
legal/node_modules/is-number/LICENSE
legal/node_modules/json-schema-traverse/LICENSE
legal/node_modules/jsonc-parser/LICENSE.md
legal/node_modules/merge2/LICENSE
legal/node_modules/micromatch/LICENSE
legal/node_modules/picomatch/LICENSE
legal/node_modules/queue-microtask/LICENSE
legal/node_modules/require-from-string/license
legal/node_modules/reusify/LICENSE
legal/node_modules/run-parallel/LICENSE
legal/node_modules/to-regex-range/LICENSE
```

Packaged READMEs are documentation authorities for the M8 tarball, not SEA runtime
inputs. The SEA release can link to the maintained documentation; it must not silently
copy or rewrite those files into a runtime asset set.

### Provider contract

M9 should introduce this semantic interface, with concrete types generated from the
closed key inventory:

```ts
interface PackagedAssetProvider {
  readonly embedded: boolean;
  keys(): readonly PackagedAssetKey[];
  read(key: PackagedAssetKey): Promise<Uint8Array>;
}
```

The filesystem provider keeps the M8 ordinary-file, non-link checks and reads from the
installed package roots. The SEA provider requires `node:sea.isSea()` to be true,
requires `node:sea.getAssetKeys()` to exactly equal the expected inventory, and uses
`getAsset(key)`.
`runCli`, normal schema loading, shipped-core loading, and init receive the provider by
dependency injection. The package entry constructs the filesystem provider; the SEA
entry constructs the SEA provider. This keeps `import.meta.url` and package-root
resolution out of the SEA entry's reachable graph.

The provider does not handle project or output paths. It grants no new read/write
authority, performs no network access, creates no temporary materialization tree, and
does not weaken existing project containment, reparse, snapshot, lock, or patch rules.

## Exact proposed M9 toolchain

M9 starts with these exact versions. Any deliberate upgrade is a reviewed replacement
of the complete version tuple followed by every gate in this document; a version range
is not acceptable.

| Component  | M9 pin          | Purpose                                                                                                                                                                                                                    |
| ---------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node       | `24.20.0`       | Latest Node 24 LTS patch at the assessment date; creates the blob and supplies the same native executable bytes.                                                                                                           |
| npm        | `11.6.2`        | Existing M8 package-manager authority.                                                                                                                                                                                     |
| TypeScript | `5.9.3`         | Existing source/declaration build authority.                                                                                                                                                                               |
| esbuild    | `0.28.2`        | Bundles the complete application graph to one CommonJS script. The exact pin follows the project's recommendation to pin pre-1.0 releases; see the [official esbuild releases](https://github.com/evanw/esbuild/releases). |
| postject   | `1.0.0-alpha.6` | Injects `NODE_SEA_BLOB` using the workflow documented by Node; see the [official postject releases](https://github.com/nodejs/postject/releases).                                                                          |

esbuild and postject become exact M9 development dependencies only. They are not
runtime dependencies, are not present in M8, and are not fetched dynamically by an M9
release job. The lockfile must bind their native package closure. Code-signing tools
come from the native platform SDK and are not npm dependencies.

The SEA executable embeds Node 24.20.0 only. Node 22 remains a supported runtime for
the portable package, not a second executable runtime; the CommonJS main shape remains
the conservative Node-22/24-compatible contract until the supported-LTS ESM SEA
contract is explicitly revalidated.

### Bundle and SEA shape

Add a dedicated `packages/cli/src/sea-entry.ts` that calls the existing async CLI
entrypoint and maps rejected promises through the existing fatal-error path. This is
necessary because the current ESM bin uses top-level `await`, while Node SEA embeds one
CommonJS main script. It is an adapter, not a second CLI implementation.

Run esbuild programmatically with this fixed effective configuration:

```text
absWorkingDir=<repository root>
entryPoints=[packages/cli/src/sea-entry.ts]
outfile=<ephemeral target directory>/sea-main.cjs
platform=node
bundle=true
packages=bundle
format=cjs
target=node24.20
splitting=false
sourcemap=false
sourcesContent=false
minify=false
legalComments=none
charset=utf8
treeShaking=true
metafile=true
logLevel=silent
external=<Node built-in module names only>
```

The build fails if the metafile reports another external import, a dynamic nonliteral
import, or a source outside the locked workspace/package closure. The entry must not
depend on `import.meta.url`. The CommonJS SEA runtime can use only its injected main,
Node built-ins, and injected assets; it must not rely on normal filesystem module
resolution.

Generate the blob with the same target Node executable and these exact SEA config
values:

```text
main=<absolute ephemeral path>/sea-main.cjs
output=<absolute ephemeral path>/sea-prep.blob
disableExperimentalSEAWarning=true
useSnapshot=false
useCodeCache=false
execArgvExtension=none
assets=<object containing every closed asset key and its absolute staged path>
```

The generated assets object has exactly the 65 keys inventoried above, sorted by key.
`useSnapshot` and `useCodeCache` remain false: Node documents cross-platform limits for
both, and code cache also disables `import()` in the embedded main. No source map,
debug sidecar, unpacked asset directory, or runtime download is part of the product.

### Native construction

For each target, an isolated native runner performs these steps:

1. Download the exact official Node `24.20.0` archive for that target, verify it against
   the authenticated and pinned official `SHASUMS256.txt` digest, and record both
   digests in provenance.
2. Use that target's Node binary to create its blob; copy that exact binary for
   injection. Never create a blob on one platform or Node patch for another.
3. Remove an existing platform signature only when the platform injection procedure
   requires it, inject `NODE_SEA_BLOB` with the target's pinned postject binary and
   Node's target-specific sentinel or fuse, and then run structural audits.
4. Run unsigned reproducibility and parity gates before any signing or notarization.
5. Sign only an already-approved unsigned digest, then verify and smoke-test the signed
   result without modifying it again.

Invoke the pinned local postject executable directly, never through a registry-resolving
`npx` fallback. The common injection argument vector is:

```text
<postject> <copied Node executable> NODE_SEA_BLOB <sea-prep.blob> --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
```

On Windows, first remove the signature on the copied upstream Node executable with
`signtool remove /s`; the later product signature is a separate user-owned step. Linux
uses the common argument vector unchanged. The deferred macOS arm64 form first uses
`codesign --remove-signature` and adds `--macho-segment-name NODE_SEA`. These are the
target-specific procedures in the pinned Node SEA documentation; the build records the
complete effective argv.

M9's required native targets are exactly `windows-x64` and `linux-x64`. `macos-arm64`
is the first optional expansion after both required targets pass; Node 24 does not
publish a macOS x64 binary. Windows Arm64, Linux Arm64, macOS x64, musl, and other
architectures are out of scope until separately proposed and gated. Injection is never
cross-platform.

## Estimated artifact matrix

Names derive from the package version and target; estimates include Node, the bundled
application, and all injected assets. M9 must replace estimates with recorded byte
counts, but size variance alone is not a release blocker.

| Target        | Status             | Native builder  | Executable                               | Estimated executable size | Required sidecars                                                                                       |
| ------------- | ------------------ | --------------- | ---------------------------------------- | ------------------------: | ------------------------------------------------------------------------------------------------------- |
| `windows-x64` | Required           | Windows x64     | `thermite-schematics-<version>-windows-x64.exe` |                85–115 MiB | `.exe.sha256`, `.cdx.json`, `.provenance.json`                                                          |
| `linux-x64`   | Required           | Linux glibc x64 | `thermite-schematics-<version>-linux-x64`       |                85–115 MiB | `.sha256`, `.cdx.json`, `.provenance.json`                                                              |
| `macos-arm64` | Deferred expansion | macOS arm64     | `thermite-schematics-<version>-macos-arm64`     |                80–110 MiB | `.sha256`, `.cdx.json`, `.provenance.json`; notarized container metadata if approved for public release |

Each CycloneDX JSON SBOM covers the exact Node binary, seven first-party packages, the
26-package third-party runtime closure, M9 build tools, and the 65 embedded asset keys.
Provenance records the clean commit, lockfile, tool versions, runner image, native Node
archive and digest, bundle and metafile digests, ordered asset-key-to-digest map, SEA
config, unsigned executable digest, parity evidence digest, and any later signed
artifact digest. Checksums are calculated from final bytes; signing therefore creates
a different checksum and provenance subject.

The existing portable npm artifact remains the reference implementation and rollback
path. SEA outputs do not replace it automatically.

## Required M9 parity suite

On each required native target, install the M8-style packed CLI into an isolated prefix
with the repository's offline/private-install contract. Run every case below once via
that reference `thermite` and once via the unsigned SEA executable against independent copies
of the same fixture:

1. `--version` and no-argument/help behavior.
2. `thermite init`, comparing the complete initialized tree and every file byte, including
   the copied `AGENTS.md`, six starter files, and locked core library.
3. All six agent commands: `validate`, `resolve`, `inspect`, `query`,
   `apply-source-patch` in both dry-run and apply modes, and `create-view`.
4. Direct `render` with the committed golden cases, including SVG file output and JSON
   output.
5. Authored validation, resolve, query, and patch failures, plus CLI usage failures.

For every invocation compare argv behavior, exit code, stdout bytes, stderr bytes,
diagnostic order and payload, created file paths, and created file bytes. Normalize
nothing except test-created absolute temporary directory prefixes explicitly marked in
the fixture. A difference is a no-go. Run the suite from a directory unrelated to the
executable and with no repository or `node_modules` on `PATH`; deny network access and
verify no unexpected files are opened or created.

Repeat all successful deterministic cases to prove stable bytes. Run the existing
`npm run check` and package/install evidence on the reference artifact before comparing
it with SEA. The native SEA process tests may not use the M8 sandbox EPERM skip path in
release evidence.

## Reproducibility specification

The reproducible subject is the **unsigned injected executable**, not a timestamped
signature. For each required target, two clean builds A and B run on separate native
runners from different absolute checkout and temporary paths with identical pinned
inputs and no network after input acquisition. Both builds must:

- use a clean, detached source commit and the locked dependency graph;
- verify every acquired archive and staged asset digest before execution;
- set locale, timezone, umask where applicable, and `SOURCE_DATE_EPOCH` to recorded
  values; sort directory enumeration, asset keys, and canonical JSON keys;
- prevent repository paths, temporary paths, runner usernames, and current timestamps
  from entering the bundle or injected section;
- use the exact configuration and native Node bytes specified above; and
- emit a build trace containing commands, versions, inputs, and output hashes without
  secrets.

A and B must have identical SHA-256 digests for `sea-main.cjs`, the SEA blob, and the
unsigned injected executable. Re-run one build on a second image with the same declared
runner specification; that unsigned executable digest must also match. A mismatch is a
no-go, not a value to normalize or waive. Canonical SBOM and provenance payloads must
also reproduce after excluding only their explicitly separate signing subject.

Timestamped Windows and Apple signatures are intentionally nonreproducible. Store the
approved unsigned digest in provenance, sign those exact bytes, and associate the
signed digest with it. Never rebuild between unsigned approval and signing.

## Threat model and trust boundary

The future executable moves schema, library, guide, template, and license bytes inside
one binary; it does not make those bytes inherently trusted. The trusted build boundary
contains the reviewed source commit, `package-lock.json`, the staged first-party asset
digests, the Task 6 third-party inventory, exact build-tool packages, the verified
official Node archive, isolated native runner, and reviewed build scripts. Signing
identities and timestamp/notary services enter the boundary only in the later signing
stage.

Project JSON, library paths declared by a project, CLI arguments, request JSON, output
locations, environment variables, and the current working directory remain untrusted
runtime input. They stay outside the asset provider and continue through existing
containment, validation, lock, reparse-point, guarded-patch, and diagnostic paths. The
provider never turns user paths into embedded asset keys.

Threats in scope are dependency or Node substitution, missing or remapped assets,
undeclared external imports, loading a nearby repository or `node_modules`, build path
or timestamp leakage, cross-target injection, post-injection byte changes, signing-key
exposure, and publication of unsigned binaries as trusted releases. Closed keys and
digest maps address asset substitution; offline locked builds and SBOMs address supply
chain drift; metafile and runtime file-access audits address hidden externals; native
parity and two-build digest gates address platform and reproducibility failures; and
isolated user-controlled signing addresses release identity.

The executable cannot protect a compromised host, malicious project content outside
the compiler's existing validation model, or stolen signing credentials. An unsigned
SEA binary establishes no publisher identity and is therefore internal test material
only.

## Signing and notarization ordering

Thermite Schematics does not obtain, store, or provision credentials. Windows Authenticode
and Apple signing/notarization are the user's future responsibility and happen only
after the required unsigned reproducibility and parity gates pass.

### Windows Authenticode

Prerequisites are a user-controlled code-signing certificate from a trusted commercial
CA, its private key in the user's protected signing facility, an approved RFC 3161
timestamp service, and the matching Windows SDK SignTool on an isolated Windows x64
runner. Microsoft documents SHA-256 file and timestamp digests in the
[SignTool documentation](https://learn.microsoft.com/windows-hardware/drivers/devtest/signtool).

The enforced order is:

1. Verify inputs, build, inject, structurally audit, reproduce, parity-test, create the
   SBOM/provenance draft, and approve the unsigned SHA-256 digest.
2. Transfer only that digest-bound executable into the user-controlled signer.
3. Authenticode-sign with SHA-256 and RFC 3161 timestamping using the effective options
   `sign /fd SHA256 /tr <approved TSA URL> /td SHA256`.
4. Verify with the effective options `verify /pa /all /v`, inspect the certificate
   chain and timestamp, and smoke-test the signed executable on clean supported Windows.
5. Calculate the final signed checksum, bind signed and unsigned digests in provenance,
   and publish only the signed Windows executable and matching sidecars.

Any missing/expired certificate, inaccessible key, unapproved timestamp service,
verification failure, or post-sign mutation is an automatic Windows public-release
no-go. Credentials must never enter npm, the repository, logs, SBOMs, provenance, or an
unsigned build runner.

### Apple signing and notarization

This path applies only if the deferred `macos-arm64` target is separately approved.
Prerequisites are a user-controlled Apple Developer Program team, Developer ID
Application certificate and private key, current Xcode command-line tools, a hardened
runtime with no debug entitlement, a secure timestamp, and user-provisioned `notarytool`
credentials. Apple lists these requirements in
[Notarizing macOS software before distribution](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution).

The enforced order is:

1. Pass native unsigned reproducibility, parity, and structural gates; approve the
   unsigned executable digest.
2. Sign the injected executable with Developer ID, hardened runtime, and secure
   timestamp, then run strict `codesign` verification. Do not inject or edit afterward.
3. Put the signed executable in the final distribution container and submit that exact
   container with `notarytool` from the user-controlled signing environment.
4. Require an accepted response, retain and review the notarization log, staple the
   ticket when the chosen container supports stapling, and verify with `stapler` and
   Gatekeeper. If offline stapling is required, use a supported DMG or PKG rather than a
   bare executable or ZIP.
5. Smoke-test on clean supported macOS, calculate final checksums, and bind the unsigned,
   signed, container, and notarization evidence digests in provenance.

Missing credentials, rejected notarization, an unreviewed log, invalid signature,
unstapled artifact where stapling is required, or failed Gatekeeper verification is an
automatic macOS public-release no-go.

Linux has no M9 signing mechanism in this specification. Consistent with D12, its
unsigned executable remains internal unless the user later approves a concrete Linux
publisher-verification policy; absence of that approval is a public-release no-go, not
an open design question.

## Executable M9 go/no-go checklist

M9 must implement the following repository script interface. Every script exits zero
only when its named evidence is complete and writes canonical JSON evidence under an
ignored, target-specific output directory. These commands are specification only; none
exists or is added in M8.

```text
npm run sea:prerequisites -- --target <windows-x64|linux-x64>
npm run sea:assets -- --target <windows-x64|linux-x64>
npm run sea:bundle -- --target <windows-x64|linux-x64>
npm run sea:build -- --target <windows-x64|linux-x64> --build-id <A|B>
npm run sea:audit -- --target <windows-x64|linux-x64> --build-id <A|B>
npm run sea:repro -- --target <windows-x64|linux-x64> --left A --right B
npm run sea:parity -- --target <windows-x64|linux-x64> --reference <absolute packed-cli tarball>
npm run sea:artifacts -- --target <windows-x64|linux-x64>
npm run check
```

The M9 unsigned engineering result is **GO** only when every required box is checked:

- [ ] `sea:prerequisites` proves the native runner, exact Node/npm/TypeScript/esbuild/
      postject tuple, verified Node archive, clean commit, lockfile, offline inputs, and
      empty output directory.
- [ ] `sea:assets` proves exact equality with the 65-key inventory, source and staged
      SHA-256 equality, legal-file coverage, no link/reparse source, and no extra key.
- [ ] `sea:bundle` proves the fixed options, CommonJS format, one entry/output, built-in-
      only externals, closed source graph, and clean metafile audit.
- [ ] Builds A and B complete natively for both `windows-x64` and `linux-x64` with the
      same Node patch used for blob creation and executable injection.
- [ ] `sea:audit` proves the expected SEA fuse/resource or section, no preexisting or
      premature signature, exact embedded key set, no unpacked runtime assets, no
      release-time network dependency, and successful clean-host startup.
- [ ] `sea:repro` proves byte-identical bundle, blob, and unsigned executable across A,
      B, and the second declared runner image for each target.
- [ ] `sea:parity` proves every version/init/agent/render/success/failure case and every
      exit, stream, diagnostic, and output byte against the packed CLI on both targets,
      with no EPERM skips.
- [ ] `npm run check` and all package/install evidence pass without a release-evidence
      skip.
- [ ] `sea:artifacts` emits the target matrix's checksum, CycloneDX SBOM, provenance,
      size, and evidence index, and an independent verifier resolves every recorded
      digest.
- [ ] The outputs are labeled and distributed as unsigned internal engineering
      artifacts only.

Public release is outside the unsigned M9 engineering scope. A Windows public release
is **GO** only after every box above plus the Authenticode sequence succeeds with
user-provided credentials. A future macOS arm64 public release is **GO** only after its
separate target approval, the same native/reproducibility/parity gates, and the complete
Apple sequence succeeds with user-provided credentials. Linux remains **NO-GO** for
public release until a user-approved publisher-verification policy is specified and
gated. No credential acquisition, signing, notarization, publishing, or release-asset
attachment is implied by this document.

This resolves the M9 design choices relevant to release: the SEA approach is feasible;
M8 is documentation-only; M9 builds unsigned internal `windows-x64` and `linux-x64`
artifacts with the exact provider, toolchain, assets, parity, and reproducibility gates
above; and public distribution is a deterministic no-go unless its stated user-owned
trust prerequisites pass. There is no unresolved release-blocking question.
