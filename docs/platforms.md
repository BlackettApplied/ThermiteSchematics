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
| macOS ARM64 | Apple Silicon Mac and prior CI | Verified | Verified with network disabled |
| Windows x64 | Native windows-2022 CI | Verified | Verified; network isolation not enforced |
| Linux ARM64 | Debian container in Docker Desktop | Verified | Verified with network disabled |
| Linux x64 | Native ubuntu-24.04 CI | Verified | Verified with network disabled |
| macOS x64 | No local test host | Not verified | Not verified |

The [ordinary CI workflow](../.github/workflows/ci.yml) runs the complete check
and runtime packaging on `macos-15`, `ubuntu-24.04`, and `windows-2022` for
pull requests targeting `release` and pushes to `release`. A parallel
`worktree` job repeats the complete check from a linked worktree on the same
three systems. Manual runs also
require the `release` branch. Pull requests and merges into `dev` skip this
workflow; contributors still run the local checks before submitting changes.
Both CI jobs upload a Vitest JSON report with per-test durations when the suite
finishes. Set `THERMITE_TEST_TIMINGS=1` with a local check to write the same
report to `coverage/test-timings.json`.
Both jobs run Vitest with three workers on Windows and two on macOS and Linux.
On fresh CI checkouts, the sequencer starts expensive files early using
`vitest.config.mjs`. Refresh those entries from the latest Windows timing
artifacts as suites move or their costs change.
Linux network-disabled acceptance uses a matching-architecture container;
Windows ARM64 and non-glibc Linux systems have not been validated. The packer
builds for its current OS and architecture; it does not cross-compile.

Historical macOS CI evidence used `macos-14`. The pinned `macos-15` ARM64
runner needs fresh source and runtime-package verification from the exact
release commit; a skipped `dev` workflow does not provide that evidence.

`watch` uses the same polling implementation on macOS, Linux and Windows. It
waits one second after each load/rebuild finishes, reloads declared project and
library inputs plus the saved packet request, and rebuilds when they change.
It does not use recursive OS file watchers. The release CI matrix runs the watch
integration tests on all three systems, including the linked-worktree check. Tests use
longer change-detection deadlines on Linux and Windows to allow for rendering
time; the polling interval is the same on every platform. In a terminal, Ctrl+C
stops watch. Windows does not support catchable POSIX termination signals, so
tests of graceful signal-handler cleanup invoke the JavaScript handler directly.

Package acceptance exercises both project templates, validation, all six agent
commands, guarded patch dry-run/apply/stale rejection, deterministic SVG/HTML/PDF,
embedded fonts, source/package drawing parity, and unchanged runtime files.
Capability-dependent skips remain visible in the test output.

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

## Typography raster checks

`alpha-pdf.test.ts` renders 300-dpi PDF crops with the development-only PDF.js
and native canvas dependencies. These checks run offline and include negative
controls for cell overpainting and proportional font substitution. PDF
rasterization itself needs no browser, including all four signal-loop variants.
The synthetic browser monospace specimen loads the shipped Noto Sans Mono face
and waits for font loading before capture, so its advance checks do not depend
on the host's generic monospace font. This is test setup; generated SVG and
runtime font selection retain their existing contracts.
No browser or raster dependency is included in the runtime package.

## Browser for tests

After `bun install --frozen-lockfile`, install the lockfile-pinned Chromium with
the same command as CI:
`bun node_modules/playwright-core/cli.js install --with-deps --no-shell chromium`.
On Linux, `--with-deps` installs system libraries through apt and needs sudo
or root privileges; omit that option if those libraries are already installed.
To find that installation's executable, run
`bun -e "import { chromium } from 'playwright-core'; console.log(chromium.executablePath())"`.
Set both `THERMITE_TEST_BROWSER` and `THERMITE_DRAW_CHROMIUM` to that path.
When `THERMITE_TEST_BROWSER` is unset, installed system Chrome/Chromium takes
precedence over the pinned cached build. Explicit overrides select the CI
binary, including on Windows or with a custom `PLAYWRIGHT_BROWSERS_PATH`. CI
caches the browser outside the checkout and exports both overrides from
`chromium.executablePath()`; the two discovery helpers do not read
`PLAYWRIGHT_BROWSERS_PATH` themselves.

The helpers have separate discovery orders:

- The PDF/browser test harness (`packages/cli/test/helpers/pdf-raster.ts`)
  uses `THERMITE_TEST_BROWSER` when defined. An invalid or empty override
  disables the helper's discovery fallback. Otherwise it tries macOS Google Chrome
  (`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`),
  `/usr/bin/chromium`, `/usr/bin/chromium-browser`, `/usr/bin/google-chrome`,
  then `%PROGRAMFILES%/Google/Chrome/Application/chrome.exe`. It next searches
  `~/Library/Caches/ms-playwright`, `~/.cache/ms-playwright`, then
  `%LOCALAPPDATA%/ms-playwright`, ignoring absent roots. Within each root,
  `chromium-*` directories are tried in reverse lexical order, with executable
  suffixes in this order: `chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
  `chrome-mac/Chromium.app/Contents/MacOS/Chromium`, `chrome-linux64/chrome`,
  `chrome-linux/chrome`, `chrome-win/chrome.exe`, `chrome-win64/chrome.exe`.
- The draw checker (`evals/draw/chromium-path.mjs`) uses a nonempty
  `THERMITE_DRAW_CHROMIUM` first; an inaccessible override throws without
  fallback. Otherwise it searches `~/Library/Caches/ms-playwright` on macOS,
  or `~/.cache/ms-playwright` on other OSes, including Windows. It tries
  `chromium-*` directories in reverse lexical order, with suffixes
  `chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
  `chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
  `chrome-mac/Chromium.app/Contents/MacOS/Chromium`, `chrome-linux64/chrome`,
  `chrome-linux/chrome`, then `chrome-win/chrome.exe`. It does not search
  system Chrome paths or `%LOCALAPPDATA%`.

Locally, without `THERMITE_REQUIRE_BROWSER=1`, only browser cases guarded with
`it.skipIf(!browserPath)` skip when the PDF harness finds no executable. Some
browser suites call `launchBrowser()` without a skip guard and fail rather than
skip if no browser is available. With no discovered path, those calls let
Playwright try its own registry, which honours
`PLAYWRIGHT_BROWSERS_PATH` and may require a headless shell absent from the
documented `--no-shell` installation.
Draw suites also fail when Chromium is unavailable, regardless of the flag.
The full check therefore needs a browser for both harnesses.
`THERMITE_REQUIRE_BROWSER=1` makes missing-browser discovery in the PDF harness
fail before any guarded case can skip. CI sets it in both jobs on all three
OSes and explicitly selects the pinned executable.

With the pinned Chromium build, default Canvas ascent and left glyph bounds on
Linux and Windows are rounded to whole user units; right bounds and text-box
widths are not uniformly integer-rounded. macOS defaults are precise. In the
[3.5 mm calibration capture](https://github.com/BlackettApplied/ThermiteSchematics/actions/runs/43726905676/artifacts/14167310551),
default versus precise measurements differ by about 0.5 mm vertically, about
1.2 mm at the Windows right edge and about 1.5 mm in Windows glyph-box width.
These are observed magnitudes, not universal bounds. See
[Chromium's small-font precision fix](https://chromium.googlesource.com/chromium/src/+/3f9f2e32ff8ce60dea2a7f897476bf20be9a950b),
the checker's [text measurements](../evals/draw/measurement/text-metrics.mjs)
and [cap-height conversion](../evals/draw/measurement/text-fields.mjs).
The [calibration tests](../evals/draw/checker-boundary-browser.test.mjs) opt into
`CanvasTextMetricsPreciseBounds`; the [default launch arguments](../evals/draw/browser.mjs)
remain empty.

Run targeted tests with `bun scripts/test.mjs <files>` after rebuilding source
changes. `bunx vitest` is unsupported on macOS: it bypasses the wrapper's
canonicalization of `TMPDIR`, `TMP` and `TEMP`. macOS temporary paths commonly
start under the `/var` symlink to `/private/var`; the source loader rejects
symlink paths, so fixtures created there can fail before their intended checks.
The wrapper resolves the temporary directory before creating fixtures.
