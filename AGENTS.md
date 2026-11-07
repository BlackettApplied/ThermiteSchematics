# Thermite Schematics engine guide

This is the TypeScript + ELK source alpha. Users can use a prebuilt runtime or a
source checkout; use a separate engine checkout and focused branch.
Agents are encouraged to fix bugs, improve docs/rendering and contribute reviewed
component models while helping users. Keep electrical projects and customer data
out of engine changes.

## Commands

- Bun 1.4.2; development and CI target macOS, Windows and Linux. Full checks need
  Python 3.12+ (`python` on Windows, `python3` elsewhere; override with
  `THERMITE_RESEARCH_PYTHON`). See [platforms](docs/platforms.md).
- Setup: `bun install --frozen-lockfile`, `bun run build`. Run `bun run check`
  before submitting a PR; it also works in linked git worktrees.
- Focused tests: `bun run test -- <file>` (Vitest; never `bun test`).
- `bun thermite.mjs <command>` runs built `packages/cli/dist/alpha.js`. After
  source changes, `bun run build` before trusting CLI output, tests or update
  scripts; many read `dist/`.
- `bun thermite.mjs init <new-directory>` writes the project guide from
  `packages/cli/assets/THERMITE_AGENTS.md` and a visible local core library.
  Follow it in the electrical project.
- `bun.lock` is active. `package-lock.json`, `test:legacy-package`, the
  `release-candidate`/`release-publish` workflows and every script they run
  (`scripts/release-*` and more) are frozen release paths; leave them alone.
  Public runtime: `scripts/runtime-package/`, `bun run package:pack`;
  see [runtime packaging](docs/runtime-package.md).

## Package map

- `packages/schema`: JSON Schemas, strict parsing, diagnostics.
- `packages/compiler`: loading, locks, IR, nets, engineering rules.
- `packages/query`: read-only graph queries and reports.
- `packages/render`: view selection, ELK layout, SVG sheets and packets.
- `packages/agent-tools`: six guarded stateless tools.
- `packages/cli`: CLI (`src/alpha.ts`), init and project guide assets.
- `packages/core-library`: shipped generic types; `libraries/`: optional sourced
  libraries; `examples/`: runnable projects; `docs/`: references.

`bun scripts/update-<name>.mjs --check` verifies; use `--write` only for an
intentional change and inspect the diff. Other goldens have no updater. Scopes:

- `shipped-core-goldens`: motor-starter lock, compiler IR, type-only patch report.
- `task4-goldens`: motor-starter/PNP CLI, renderer and agent goldens, R005 cases.
- `starter-fixtures`: `packages/cli/templates/starter-default` JSON and lock (both inits).
- `motor-starter-presentation`: motor-starter manifest and presentation.

## Invariants and review

Preserve UUID identity, deterministic output and net IDs, strict UTF-8 and
duplicate-key rejection, library byte locks, original continuous SVG rendering,
and existing request formats. Only wires, jumpers and two-ended cable cores join
nets; device functions never short terminals. JSON is electrical source; SVG is
generated. ELK owns placement/routing; the catalog owns symbol primitives.
Update `packages/cli/assets/THERMITE_AGENTS.md` and docs for user-visible changes
or always-on project rules.

Preserve diagnostics; never invent electrical facts or automatic repairs.
Agent results go to stdout only on success, reports to stderr; keep exit 0/1/2
and guarded dry-run/apply contracts. Read [agent requests](docs/agent-requests.md)
before changing these contracts or project source/presentation.

Include a synthetic reproduction and appropriate verification, with negative
tests for connectivity/validation changes. Inspect layout changes at print size
in both flows; explain R006 rather than clip or drop conductors. Follow
[CONTRIBUTING](CONTRIBUTING.md) for component sourcing, complete connection
inventories, lock updates, fork/PR review and sign-off (`git commit -s`). Target
`dev`; a human reads and accepts the CLA, never an agent on their behalf.

The [legacy guide](docs/legacy/private-release-agent-guide.md) preserves the
former root sections; see [release controls](docs/legacy/private-release.md).
`packages/cli/assets/AGENTS.md` is frozen and read by every init.
