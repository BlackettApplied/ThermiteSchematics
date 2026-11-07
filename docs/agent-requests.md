# Agent request examples

These six stateless JSON agent tools retain their existing request/result
contracts in the Bun alpha. The examples below are executed by
[`agents-guide.test.ts`](../packages/cli/test/agents-guide.test.ts); their JSON
reference requests remain identical to the frozen legacy examples; refresh their
byte guard from current inspection before execution. `thermite guide` lists the
offline reference topics. Use the same runtime that initialized the project. The additional
source-guard step is tested separately.

Runtime users: run `bun <runtime>/thermite.mjs init <new-directory>`, then enter
that project. In the commands below, set `thermite_entry` to the absolute path
to that runtime's `thermite.mjs`. Source users follow the
[source setup](../packages/cli/README.md#source-alpha-initialize-and-inspect),
then use their built checkout's launcher. Use a new destination directory and
read the generated project guide before editing.

For POSIX shells, copy this line and replace the absolute runtime path:

`thermite_entry=/absolute/path/to/runtime/thermite.mjs`

PowerShell: set `$thermite_entry = 'C:/path/to/runtime/thermite.mjs'`; replace the POSIX `< resolve.request.json` input redirection with `Get-Content -Raw resolve.request.json | bun $thermite_entry agent resolve --input -`.

JSON project source is authoritative; SVG is generated output. Resolve objects
and topology before editing. Use this loop for each change:

```text
validate → resolve/inspect/query → dry-run patch → apply patch → validate → create-view
```

Each call compiles fresh. Keep requests in JSON files or pass them on standard
input with `--input -`. Preserve compiler diagnostics; never invent electrical
validity, suppress diagnostics, infer an automatic engineering repair, or invent
schematic geometry.

## Six executable agent commands

The examples below start in the initialized project directory and use `project: "."`.

### Validate

Save as `validate.request.json`:

```json
{
  "format": "agent-tool-request/0.1",
  "project": "."
}
```

```sh
bun "$thermite_entry" agent validate --input validate.request.json
```

Expected response: exit `0`; one `agent-tool-result/0.1` JSON object on stdout with `tool: "validate"` and `value.valid: true`; an `agent-tool-report/0.1` JSON object on stderr with no error.

### Resolve

Save as `resolve.request.json`:

```json
{
  "format": "agent-tool-request/0.1",
  "project": ".",
  "target": { "by": "designation", "value": "PS1" }
}
```

```sh
bun "$thermite_entry" agent resolve --input - < resolve.request.json
```

Expected response: exit `0`; stdout contains an `agent-tool-result/0.1` result resolving `PS1`; stderr contains the success report.

### Inspect

Save as `inspect.request.json`:

```json
{
  "format": "agent-tool-request/0.1",
  "project": ".",
  "selector": { "by": "designation", "value": "PS1" }
}
```

```sh
bun "$thermite_entry" agent inspect --input inspect.request.json
```

Expected response: exit `0`; stdout contains the canonical inspection of `PS1`; stderr contains the success report.

### Find the patch guard

Save this opt-in inspection as `inspect-source.request.json`.

```json inspect-source.request.json
{
  "format": "agent-tool-request/0.1",
  "project": ".",
  "selector": { "by": "designation", "value": "PS1" },
  "include": ["source"]
}
```

```sh
bun "$thermite_entry" agent inspect --input inspect-source.request.json
```

Expected response: exit `0`, the usual split result/report streams, and
`value.object.source` with `file: "devices/equipment.json"`,
`pointer: "/objects/0"`, the object's `uid`, `patchEligible: true`, and
an `integrity` computed from the current file bytes. Core 0.2.0 starters include
PS1's deferred AC-feed review, so their hash differs from the frozen 0.1.0
sample below. Consume returned file, pointer, UID and integrity values; the old
sample guard correctly fails with A004 on the new starter.

For example, given the parsed result `inspection`, build a dry-run request using
its values and a UUID test immediately before the object's edits:

```js
const source = inspection.value.object.source;
if (!source.patchEligible) throw new Error(source.reason);
const guardedPatch = {
  format: "agent-tool-request/0.1",
  project: ".",
  patchFormat: "json-patch/0.1",
  dryRun: true,
  files: [{
    path: source.file,
    expectedIntegrity: source.integrity,
    operations: [
      { op: "test", path: `${source.pointer}/uid`, value: source.uid },
      { op: "replace", path: `${source.pointer}/description`, value: "24 VDC starter control power supply" },
    ],
  }],
};
```

Pointers refer to positions before the patch. Earlier structural operations can
shift array indexes; the UUID test rejects a shifted target with A002
`test-failed`. Use one `files[]` entry per file, and escape appended field segments
by replacing `~` with `~0` and `/` with `~1`. After A004, re-inspect and rebuild the
whole request rather than copying `actualIntegrity` into old operations.

The result's `sourceFiles` includes guards for every patchable file in the
admitted snapshot, including empty sources and referenced `presentation.json`.
Use these guards to add a first wire or edit presentation without manual hashing.
It also includes referenced library files, which remain ineligible. Eligibility
is a document-class rule; the patch tool still checks project-wide path safety,
operations, byte guards and writer reservations. Library-origin sources omit
`uid`; use project-object sources for the UUID test.

A file outside that snapshot is not reread or listed, and it is not patchable
(A003); new or unreferenced files must first be admitted by the manifest and
re-inspected. When the project fails to compile, inspect and resolve return no
guards; only then, to patch the repair, hash that file's raw bytes explicitly
(adjust the path):

```sh
bun -e 'const fs=require("node:fs"), c=require("node:crypto"); console.log("sha256-"+c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("base64"))' devices/equipment.json
```

Generate UUIDs for new objects with `bun -e 'console.log(crypto.randomUUID())'`.

### Query

Unlike `resolve.target` and `inspect.selector`, operation and selector are nested
under `query`. The flat form is not accepted (A001 at `/query`); keep the envelope
shown below. `thermite agent query --help` prints the complete executable shape.

Save as `query.request.json`:

```json
{
  "format": "agent-tool-request/0.1",
  "project": ".",
  "query": {
    "operation": "net",
    "selector": {
      "by": "parts",
      "deviceDesignation": "PS1",
      "terminalKey": "+"
    }
  }
}
```

```sh
bun "$thermite_entry" agent query --input query.request.json
```

Expected response: exit `0`; stdout contains the derived `PS1.+` net result; stderr contains the success report.

### Apply a guarded source patch

Save this reference dry-run request as `patch-dry-run.request.json`, replacing
`expectedIntegrity` with `source.integrity` from the current inspection above
before executing it. Keep its operations and review them against the returned
pointer and UID:

```json
{
  "format": "agent-tool-request/0.1",
  "project": ".",
  "patchFormat": "json-patch/0.1",
  "dryRun": true,
  "files": [
    {
      "path": "devices/equipment.json",
      "expectedIntegrity": "sha256-VxO18aXXz5q4BY3r4k0bRGP8Ob1IAkJi9Tx34qBIARk=",
      "operations": [
        {
          "op": "test",
          "path": "/objects/0/description",
          "value": "480 VAC line-to-line to 24 VDC control power supply"
        },
        {
          "op": "replace",
          "path": "/objects/0/description",
          "value": "24 VDC starter control power supply"
        }
      ]
    }
  ]
}
```

```sh
bun "$thermite_entry" agent apply-source-patch --input patch-dry-run.request.json
```

Expected response: exit `0`; stdout reports `dryRun: true`; stderr contains the success report; no source byte changes.

After reviewing that response, copy the request to `patch-apply.request.json`, change only `"dryRun": true` to `"dryRun": false`, and apply it:

```sh
bun "$thermite_entry" agent apply-source-patch --input patch-apply.request.json
bun "$thermite_entry" agent validate --input validate.request.json
```

Expected response: both calls exit `0`; the patch result reports `dryRun: false`, and the second validation reports `valid: true`.

### Repair schema errors through the guarded loop

When validation reports E012 (an unexpected property), E013 (such as an uppercase
UUID), or a repairable source schema error, inspect and resolve cannot return guards.
Read the named source file as raw JSON and review the diagnostic pointers and
intended values. Hash its current bytes with the recipe above, test the existing
UID, and dry-run a patch that fixes all errors together. The patch operates on
the parsed JSON even when its current shape fails schema validation. Only
manifest-admitted project sources and the referenced presentation are eligible.

The top level must be an object. A JSON-valid `null`, number, string or array
cannot be repaired through this tool because root replacement is forbidden
(A002); report that authoring error for explicit correction rather than bypassing
the guarded loop. An object such as `{"objects": 5}` can be repaired at a subpath.

For example, suppose the first device in `devices/equipment.json` has an
accidentally uppercase UUID and an unwanted `unexpected` property. Save this as
`repair-schema.mjs` and run it from the project directory. This example restores
that UUID's lowercase spelling; it does not create a new identity.

```js repair-schema.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const file = "devices/equipment.json";
const bytes = readFileSync(file);
const source = JSON.parse(bytes.toString("utf8"));
const uid = source.objects[0].uid;
const request = {
  format: "agent-tool-request/0.1",
  project: ".",
  patchFormat: "json-patch/0.1",
  dryRun: true,
  files: [{
    path: file,
    expectedIntegrity: "sha256-" + createHash("sha256").update(bytes).digest("base64"),
    operations: [
      { op: "test", path: "/objects/0/uid", value: uid },
      { op: "remove", path: "/objects/0/unexpected" },
      { op: "replace", path: "/objects/0/uid", value: uid.toLowerCase() },
    ],
  }],
};
writeFileSync("repair-schema.request.json", JSON.stringify(request, null, 2) + "\n");
```

```sh
bun repair-schema.mjs
bun "$thermite_entry" agent apply-source-patch --input repair-schema.request.json
```

Expected: exit `0`, `dryRun: true`, `applied: false`, with unchanged project
bytes. Review the result, then copy the request to `repair-schema-apply.request.json`
changing only `dryRun` to `false`:

```sh
bun "$thermite_entry" agent apply-source-patch --input repair-schema-apply.request.json
bun "$thermite_entry" agent validate --input validate.request.json
```

Both calls exit `0`; only the target source changes. A candidate is accepted only
if the **whole staged project compiles successfully**, including schema, lock,
reference and engineering checks. Warnings and information do not prevent a
patch. A partial schema repair or a remaining error elsewhere is refused with
the remaining diagnostics and no source writes. Use multiple operations/files in
one request when errors must be fixed together. Byte guards, operation tests,
snapshot revalidation and writer reservations still apply.

JSON syntax errors and duplicate keys cannot be patched: A006 names the file and
the parser's line and column, alongside the original E002/E003 diagnostics. Make
an ordinary edit to source, presentation, manifest or library JSON, then validate
again and resume the guarded loop where eligible. For a corrupt
`electrical-system.lock.json`, run `thermite lock .` to regenerate the lock instead
of hand-editing it, then validate. The patch tool still cannot
edit the manifest, lock or library files; use their documented authoring workflow.
The example above is executed by
[`agent-schema-repair.test.ts`](../packages/cli/test/agent-schema-repair.test.ts).

### Create a view

Save as `create-view.request.json`:

```json
{
  "format": "agent-tool-request/0.1",
  "project": ".",
  "spec": {
    "format": "schematic-view-request/0.2",
    "root": { "by": "designation", "value": "PS1" },
    "intent": { "kind": "loads" },
    "flow": "left-to-right"
  }
}
```

```sh
bun "$thermite_entry" agent create-view --input create-view.request.json
```

Expected response: exit `0`; stdout contains a result whose value includes the deterministic PS1 loads SVG and normalized view; stderr contains the success report. Write the returned SVG string to an ordinary `.svg` file without changing it.

## Split streams

After a tool dispatches successfully, stderr always carries the `agent-tool-report/0.1` report. On success only, stdout carries the `agent-tool-result/0.1` result. A failure has empty stdout and its report on stderr. Every non-zero outcome of
these six dispatched tools has a non-null `error` or an error-severity diagnostic
naming its cause. Diagnostic-only compiler failures retain `error: null`. Do not
merge the streams before parsing them. CLI usage errors before dispatch (such as
missing `--input`) use plain-text stderr and exit 2; they are outside this JSON
outcome invariant. `packet --strict` warnings-only failures are also outside it;
see [views](views.md).

## Exit classification

- Exit `0`: success, including a result accompanied by compiler warnings.
- Exit `1`: authored validation, `A`, `Q`, or `R` expected failure.
- Exit `2`: command usage or tool/infrastructure failure.

## Engineering responsibility

Consume and preserve compiler diagnostics. Do not invent electrical validity, suppress a diagnostic, infer an automatic engineering fix, or invent schematic geometry in the agent. Change authoritative JSON only after resolving the objects and topology involved.

## Guarded JSON Patch rules

Use `json-patch/0.1`, include the current `expectedIntegrity` for every target, and dry-run first. A successful multi-file request is committed with per-file atomicity under the tool's guarded project-snapshot contract. The patch tool cannot create, delete, or rename files and cannot mutate the manifest, lock, or local/shipped library files.

## Presentation changes

The one referenced project presentation document, `presentation.json`, is patch-eligible like a project source document. Use the same integrity guard and dry-run-first process. `AGENTS.md` is not patch-eligible.

## Local libraries

Name/version-only library references are reserved for libraries shipped with Thermite Schematics. Author a local library with an explicit relative `path` in `system.json`; put its manifest in `library.json`, put its declared type sources below that directory, and run `bun "$thermite_entry" lock` after changing its bytes. The patch tool does not create or modify library files.

This contract does not provide MCP, natural-language tool inputs, persistent sessions, automatic engineering repairs, or library-file creation through `apply-source-patch`.

## Selector vocabulary and integrity

`resolve.target.by` is `uid`, `designation`, `type` or `text`.
`inspect.selector.by` is `uid` or `designation`. Query operations are
`neighbors`, `trace`, `net` and `cable`; object queries use `uid` or
`designation`. Net selectors use `id` (`value: {deviceUid, terminalKey}`),
`parts` (`deviceDesignation`, `terminalKey`) or `display` (`value`, such as
`PS1.+`). Query `trace` follows the selected device's connected physical
component; it has no `to` field. See the
[query contract](../packages/agent-tools/README.md).

`expectedIntegrity` is exactly `sha256-` followed by base64 SHA-256 of the file's
raw current bytes. Do not hash parsed or reformatted JSON. Fresh inspection with
`include: ["source"]` supplies this value; after a stale guard, re-inspect and
review pointers and UUIDs before rebuilding the request.

## Request and query errors

`thermite guide diagnostics <code>` explains every CLI and agent code (case
insensitive). A001 describes request shape/usage, A002 patch-operation failure,
A003 a disallowed target, A004 a stale byte guard and A005 a writer reservation.
A006 means the source JSON must be repaired before a guarded patch can apply.
Read the exact error's reason and locations; never infer an electrical repair.

During apply, A004 can also name a changed project manifest, lock or library
file that was not a request target; its `expectedIntegrity` comes from the loaded
project and can be `"missing"`. Reload the project and retry with refreshed
guards, pointers and UUID tests.

- Q001: an agent query/lookup found no object with the selected UID or
  designation. The CLI also uses it for a `diagnostics --device/--location` scope
  with no matches, or an invalid/unreadable `continuity` request. Read the message for the
  failed lookup or request requirement.
- Q002: the object exists but has the wrong kind. Neighbors, trace and terminal
  lookup require a device; cable lookup requires a cable. A `conductors` view
  uses cable lookup, so a non-cable root also returns Q002. Other rooted view
  mode/mapping mismatches use R001; this existing distinction is preserved.
- Q003: a display terminal reference cannot be parsed into designation and key.
  Use a `parts` or `id` selector to state them explicitly.
- Q004: the device exists but does not declare that terminal key. Read its
  bounded declared-key list and full-list lookup, if supplied.

Renderer R codes and CLI T001 exceptions are covered in [views](views.md).

## Offline request vocabulary

Every `thermite agent <tool> --help` includes a complete request for a freshly
initialized default starter and a minimal request when optional fields differ.
Copy a JSON block unchanged into a request file and run it from that starter.
The patch example is a guarded, test-only dry run; on an existing project obtain
fresh source metadata and rebuild the UUID test and integrity guard.

Help prints accepted literals as JSON, keyed by field path; a suffix names the
operation or request version. Selector shapes are above and in complete help
requests. Source object shapes are available through `thermite guide schema`
and [modeling](data-model.md).
