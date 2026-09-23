# Platform checks

Thermite runs locally on Bun 1.4.2. Runtime users need only Bun and the matching
runtime ZIP. Source contributors also need Git and Python 3.12 or later for the
full development checks. Research tests use `python` on Windows and `python3`
elsewhere; set `THERMITE_RESEARCH_PYTHON` to override the executable.

## Validation matrix

These targets have passed source checks and runtime package acceptance during
release preparation. Each release repeats verification from its exact source
commit. Use its [release notes and verification reports](https://github.com/BlackettApplied/ThermiteSchematics/releases)
for the commit, test counts, skips and downloaded-asset evidence.

| Platform | Environment | Source check | Runtime package |
| --- | --- | --- | --- |
| macOS ARM64 | Apple Silicon Mac and macos-14 CI | Verified | Verified with network disabled |
| Windows x64 | Native windows-2022 CI | Verified | Verified; network isolation not enforced |
| Linux ARM64 | Debian container in Docker Desktop | Verified | Verified with network disabled |
| Linux x64 | Native ubuntu-24.04 CI | Verified | Verified with network disabled |
| macOS x64 | No local test host | Not verified | Not verified |

The [ordinary CI workflow](../.github/workflows/ci.yml) runs the complete check
and runtime packaging on `macos-14`, `ubuntu-24.04`, and `windows-2022`.
Linux network-disabled acceptance uses a matching-architecture container;
Windows ARM64 and non-glibc Linux systems have not been validated. The packer
builds for its current OS and architecture; it does not cross-compile.

Package acceptance exercises both project templates, validation, all six agent
commands, guarded patch dry-run/apply/stale rejection, deterministic SVG/HTML/PDF,
embedded fonts, source/package drawing parity, and unchanged runtime files.
Capability-dependent and historical private-release skips remain visible in the
test output; they are not replaced with unconditional platform skips.

## Repeat the checks

On each native host:

```sh
bun install --frozen-lockfile
bun run check
bun run package:pack
```

Use `bun run package:pack --preview` only for uncommitted development changes.
On Windows, use ordinary directories rather than junctions or symlinks for
electrical projects and their libraries. JSON paths use forward slashes on all
platforms. Quote command paths containing spaces, including the runtime path.

For Linux, start Docker Desktop or Docker Engine and run:

```sh
bun run check:linux
```

The runner copies Git-tracked and unignored files into a temporary checkout,
installs dependencies in a Linux image, and runs the full check as a non-root
user with two test workers to limit memory use. It then builds and verifies a preview runtime in a fresh container with
`--network=none`. Artifacts are copied to `release-out/platform/`. Containers,
the temporary image, and the temporary checkout are removed when the runner
finishes, including failed checks. Forcefully terminating the runner can leave
temporary resources behind; remove those task-specific resources manually.
The Docker build requires network access; the full source suite includes registry
installation probes. `--init` reaps descendants during process-interruption tests.
Do not build the Dockerfile directly from a working tree containing ignored
private projects; use the runner's filtered build context.

The default architecture matches the host. To select one explicitly:

```sh
bun run check:linux --platform linux/arm64
bun run check:linux --platform linux/amd64
```

Docker must support the selected architecture. Emulation is slower and is not a
substitute for native release testing. A failed or interrupted emulated suite is
not recorded as a pass.

## Network isolation evidence

`verification.json` records the mechanism actually used for consumer commands:

- `macos-sandbox`: the macOS sandbox denies networking.
- `loopback-only-network-namespace`: Linux has no non-loopback network interface;
  the Docker runner enforces this with `--network=none`.
- `not-enforced`: the verifier did not enforce network isolation. This includes
  native Windows and normal network-enabled Linux verification.

All consumer checks use an empty home/cache and restricted executable search
path. Those controls do not prove network isolation. Do not describe a Windows
verification report as an enforced offline test unless separate network controls
were applied and recorded.
