# Thermite Schematics project guide

TypeScript + ELK alpha; Bun 1.4.2. `thermite` means
`bun <thermite>/thermite.mjs`; use one absolute runtime/source path outside this
project (ask if unknown). No `thermite` is on PATH.
Never install/build in a downloaded runtime. In source run
`bun install --frozen-lockfile && bun run build` before use and after changes.

```sh
thermite init ../conveyor --name "Conveyor 1"
thermite init ../cabinets --template cabinets
```

`init` needs a new directory. `starter` has PS1, a 24 VDC supply feeding PLC1; `cabinets` joins TB1/TB2 with CBL1 (two used, two spare cores). `--name` sets `project.name`, the title-block heading.

When using a runtime package, check existing issues at
https://github.com/BlackettApplied/ThermiteSchematics/issues.
For bugs, gaps or unclear docs, draft an issue locally unless the user explicitly asks you to file it (search and public library GET examples in `thermite guide libraries`).
Include use case, expected/actual behavior, minimal repro, diagnostics, Thermite/Bun versions and OS; redact A005/W801 hostnames and absolute paths. Never patch downloaded runtimes.

Fix a separate engine checkout; follow its AGENTS.md/CONTRIBUTING.md for PRs.
No private data/credentials in issues/PRs.
Humans accept the CLA; agents never sign it.
`thermite guide` lists topics, schemas and diagnostic codes.

## Authority and workflow

Before extending a starter, run `thermite guide agent-requests` and follow **Extend a starter**. Guard existing files from inspection through dry-run and apply, including any undo. Never use git checkout or rm to undo an edit to a registered source.

Electrical JSON is authoritative. PDF/SVG/HTML are generated. Never hand-author schematic geometry, infer engineering repairs or suppress compiler diagnostics. Functions never automatically join physical nets.

Invent no pins, ratings, spares or title/revision data. Mark terminals unused
or deferred only with explicit user intent. After library edits, run `thermite lock .`
before validation. Snapshot before edits with `thermite snapshot -o drawings/before.json`.

To edit existing source/presentation files:

`validate → resolve/inspect/query → dry-run patch → apply patch → validate → create-view`

The six stateless tools: `thermite agent <tool> --input <file|->`. Requests have `"format": "agent-tool-request/0.1"` and `"project": "."`. stdout: success result only; stderr: report (diagnostics/error), always. Split streams. Exit 0: success; 1:
authored/expected failure; 2: usage/infrastructure failure. Diagnostics may carry `allowed`, `allowedCount`, `allowedLookup` (full-list lookup) and `pattern`.

- `validate`: no other fields.
- `resolve`: `target: {by: "uid"|"designation"|"type"|"text", value}`.
- `inspect`: `selector: {by: "uid"|"designation", value}`.
- `query`: `query: {operation: "neighbors"|"trace"|"cable", selector: {by: "uid"|"designation", value}}`,
  or `query: {operation: "net", selector: {by: "display", value: "PS1.+"}}`.
- `apply-source-patch`: `patchFormat: "json-patch/0.1"`, `dryRun`, and `files`,
  each with `path`, current `expectedIntegrity` and JSON Patch `operations`
  (`test`, `add`, `remove`, `replace` only). Dry-run first, review the result,
  then apply the same request with `dryRun: false`. Only existing referenced source/presentation files qualify (else A003): not `system.json`, library lock, libraries or this guide. Per-file atomicity/snapshot guards apply.
- `create-view`: `spec`, one view without `page`. Returns original continuous SVG or a complete cable core sheet. Multi-sheet views fail R006. Read retry reasons. For R006, narrow selection or use larger paper. Never change connectivity or shrink text to fit.

Applies (not dry runs) reserve `.thermite-schematics-write.lock` at canonical project root through revalidation/commit/rollback; distinct from library lock. Never commit it (alpha `init` gitignores it). A005/exit 1 contention: exact path, owner PID/hostname/version, creation time, age.
Wait for a live owner. Dead PID on the recorded host indicates abandonment: confirm all writers stopped, then remove exactly that path. Check unknown/other-host owners on their host; age alone never suffices. After other edits, re-inspect/rebuild the patch; never just update its integrity. On POSIX the CLI releases on unhandled SIGINT/SIGTERM/SIGHUP then
re-raises; embedded hosts keep their own handlers, and signal-revoked writes fail
closed. Forced termination may leave the reservation. W801 names a failed release after a successful commit: verify instead of replaying; remove the leftover only after the command exits and all writers stop. Failed applies name leftover paths too. Rollback refuses changed chains/bytes; incomplete restore exits 2, listing restored/unrestored files and reasons.

Get guards from agent `inspect`/`resolve` with `include: ["source"]`: use
`source.file` as `files[].path` and `source.integrity` as `expectedIntegrity`
(one entry per file; `sourceFiles` also covers empty sources and presentation).
Patch only `patchEligible: true` sources. Pointers are pre-patch positions:
immediately before each object's edits add
`{"op":"test","path":"<source.pointer>/uid","value":"<source.uid>"}`; escape
appended segments (`~`→`~0`, `/`→`~1`). After A004, re-inspect and rebuild.
When compilation fails (no guards returned), hash raw source bytes and UID-test a schema/semantic repair; see `thermite guide agent-requests`.
For E011 shape errors, patch the parsed value. An E002 syntax error or a duplicate key needs an ordinary syntax repair, then validation. UUIDs: second line:

```sh
bun -e "const b=require('fs').readFileSync(process.argv[1]);console.log('sha256-'+require('crypto').createHash('sha256').update(b).digest('base64'))" devices/equipment.json
bun -e "console.log(crypto.randomUUID())"
```

Write new files completely before listing them in `sources` in `system.json`. Once listed, use guarded patches for every edit, including E011 repairs, except for JSON syntax repair. Then run `thermite validate .`.
To undo registration of a new file, remove it from `sources` in `system.json`, confirm no source glob still matches it, then delete the unregistered file.

Every new object needs a fresh
lowercase UUID `uid` (uppercase fails E013). Wire, jumper and cable-core
endpoints and potential `at` are `{"device": "PLC1", "terminal": "X2.0"}`: a
designation and an exact, case-sensitive terminal key (E101/E102 otherwise).
Dotted `PLC1.X2.0` is display syntax only. Function keys are not terminal keys:
core `plc-compact` function `do0` is terminal `X2.0`. Take UIDs and keys from
`inspect`, never from names. An `exclusive` terminal takes one conductor (E201).

Voltage checks (E300-E302) run only on nets that carry a `potential`
(`{uid, kind: "potential", name, at, electrical: {nominal_voltage, voltage_type}}`).
Terminal ratings never create one, even on a source: 480 VAC wired to a 24 VDC
input warns W303 (ratings disagree) until potentials declare voltage_type.
I304/I305 list unassessed multi-/single-rated nets; I208 lists skipped checks.
Info exits 0, even with `--strict`. The starter declares only +24VDC and 0VDC
at PS1; declare potentials at added sources.

Use `-o` for `view`/`packet`/`report` HTML. `create-view` and `inspect` return kilobytes.
Packet JSON `html` matches `.html` byte for byte. Text fitting uses bundled fonts.
Use a short group `lineReference` for circuit captions.

Keep captions clear of wires.
Top-down can try tighter spacing once after a label or span refusal.
Single control views can reflow at the same print scale.
See `thermite guide circuit-views` for rail crossings and terminal marks.

## Offline project workflows

After the last edit, validate, export a bundle, inspect the drawings, and run
`export check` before handoff. See `thermite guide project-workflows`.
For exact shapes use `thermite guide schema`. Use `thermite guide drawing-frames`
before changing paper frames or title data.
