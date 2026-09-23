# Thermite Schematics Agent Guide

## Repository development: TypeScript alpha

This checkout is the Thermite TypeScript + ELK alpha source. For engine work,
run `bun install --frozen-lockfile`, `bun run build`, and `bun run check`; invoke
the source entry point with `bun thermite.mjs`. Run focused tests with
`bun run test -- <file>`, not `bun test`; the suite runs on Vitest. Development
and CI currently target Apple Silicon macOS with Bun 1.4.2. `bun.lock` is the
active lock; `package-lock.json` serves only the frozen historical release
tooling. Preserve the original renderer and guarded agent contracts. See
CONTRIBUTING.md for engine and library review expectations.

Users can run a prebuilt runtime package or a source checkout. Engine changes
belong in a separate source checkout. Agents are encouraged to fix bugs, improve
documentation and rendering, and contribute reviewed component models while
helping users. Work on a focused branch, include a reproduction
and appropriate verification, and run `bun run check` before submitting a PR.
Keep engine changes separate from the user's electrical project and exclude
customer data. Follow CONTRIBUTING.md for fork/PR and sign-off requirements;
CLA acceptance belongs to the human contributor, not the agent.

For new electrical projects, `bun thermite.mjs init <new-directory>` writes the
alpha project guide from `packages/cli/assets/THERMITE_AGENTS.md` and creates a
visible local core library. Use that generated guide in the electrical project.
The sections below document the original private POC distribution and remain
applicable to existing projects using that exact private tarball. Its isolated
installation instructions, including their Node/npm commands, do not apply to
this source checkout; use `bun thermite.mjs` here and the generated alpha guide
for new projects.

## 1. Runtime and private installation

Use Node.js `^22.12.0 || >=24` (Node 22.12 or a supported later release; Node 23 is excluded). Obtain the authorized private `thermite-cli-0.2.0.tgz`, verify its supplied SHA-256 file, and install that downloaded tarball without registry access:

```sh
npm install --global --prefix <isolated-prefix> --offline --ignore-scripts --no-audit --no-fund --package-lock=false --install-links=false --omit=dev --workspaces=false --userconfig <empty-user-npmrc> --globalconfig <empty-global-npmrc> --cache <empty-cache> <absolute-downloaded-thermite-cli-0.2.0.tgz>
```

Invoke only the `thermite` command installed under that isolated prefix.

## 2. Project authority

An initialized project has this fixed tree:

```text
AGENTS.md
system.json
presentation.json
electrical-system.lock.json
devices/equipment.json
connections/control-power.json
potentials/potentials.json
```

The JSON project source is authoritative. SVG is generated output: never hand-author SVG geometry or treat an SVG as electrical source. `system.json` references project source and presentation files. `electrical-system.lock.json` binds the shipped library bytes.

## 3. Agent workflow

Use this loop for every change:

```text
validate → resolve/inspect/query → dry-run patch → apply patch → validate → create-view
```

Each call is stateless and compiles the project fresh. Keep every request in a JSON file, or pass it on standard input with `--input -`.

## 4. Six executable agent commands

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
thermite agent validate --input validate.request.json
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
thermite agent resolve --input - < resolve.request.json
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
thermite agent inspect --input inspect.request.json
```

Expected response: exit `0`; stdout contains the canonical inspection of `PS1`; stderr contains the success report.

### Query

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
thermite agent query --input query.request.json
```

Expected response: exit `0`; stdout contains the derived `PS1.+` net result; stderr contains the success report.

### Apply a guarded source patch

Save this dry-run request as `patch-dry-run.request.json`:

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
thermite agent apply-source-patch --input patch-dry-run.request.json
```

Expected response: exit `0`; stdout reports `dryRun: true`; stderr contains the success report; no source byte changes.

After reviewing that response, copy the request to `patch-apply.request.json`, change only `"dryRun": true` to `"dryRun": false`, and apply it:

```sh
thermite agent apply-source-patch --input patch-apply.request.json
thermite agent validate --input validate.request.json
```

Expected response: both calls exit `0`; the patch result reports `dryRun: false`, and the second validation reports `valid: true`.

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
thermite agent create-view --input create-view.request.json
```

Expected response: exit `0`; stdout contains a result whose value includes the deterministic PS1 loads SVG and normalized view; stderr contains the success report. Write the returned SVG string to an ordinary `.svg` file without changing it.

## 5. Split streams

After a tool dispatches successfully, stderr always carries the `agent-tool-report/0.1` report. On success only, stdout carries the `agent-tool-result/0.1` result. A failure has empty stdout and its report on stderr. Do not merge the streams before parsing them.

## 6. Exit classification

- Exit `0`: success, including a result accompanied by compiler warnings.
- Exit `1`: authored validation, `A`, `Q`, or `R` expected failure.
- Exit `2`: command usage or tool/infrastructure failure.

## 7. Engineering responsibility

Consume and preserve compiler diagnostics. Do not invent electrical validity, suppress a diagnostic, infer an automatic engineering fix, or invent schematic geometry in the agent. Change authoritative JSON only after resolving the objects and topology involved.

## 8. Guarded JSON Patch rules

Use `json-patch/0.1`, include the current `expectedIntegrity` for every target, and dry-run first. A successful multi-file request is committed with per-file atomicity under the tool's guarded project-snapshot contract. The patch tool cannot create, delete, or rename files and cannot mutate the manifest, lock, or local/shipped library files.

## 9. Presentation changes

The one referenced project presentation document, `presentation.json`, is patch-eligible like a project source document. Use the same integrity guard and dry-run-first process. `AGENTS.md` is not patch-eligible.

## 10. Local libraries

Name/version-only library references are reserved for libraries shipped with Thermite Schematics. Author a local library with an explicit relative `path` in `system.json`; put its manifest in `library.json`, put its declared type sources below that directory, and run `thermite lock` after changing its bytes. The patch tool does not create or modify library files.

This contract does not provide MCP, natural-language tool inputs, persistent sessions, automatic engineering repairs, or library-file creation through `apply-source-patch`.
