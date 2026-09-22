# `@thermite/compiler`

The compiler turns one locked `electrical-system/0.1` project into deterministic
`electrical-ir/0.1`, evaluates the fixed engineering rules, and returns detached
compiled `project-presentation/0.1` context beside the IR.

```ts
import { compileProject, evaluateRules, serializeIr } from "@thermite/compiler";

const result = await compileProject("examples/motor-starter");

if (result.ok) {
  const repeatedDiagnostics = evaluateRules(result.ir);
  process.stdout.write(serializeIr(result.ir));
  console.error(result.presentation.revision);
} else {
  console.error(result.diagnostics);
}
```

Every compile loads a fresh project snapshot. Serialized IR is derived output, not an
authoritative input or persistent cache.

## Successful result

A successful `CompileResult` contains:

```ts
interface CompiledProjectPresentation {
  readonly format: "project-presentation/0.1";
  readonly revision: string;
  readonly backgroundColor: string;
  readonly titleBlockLines: readonly string[];
}

interface CompileSuccess {
  readonly ok: true;
  readonly diagnostics: Diagnostic[];
  readonly ir: ElectricalIr;
  readonly presentation: CompiledProjectPresentation;
}
```

Presentation stays beside `electrical-ir/0.1` because canvas and title policy are not
electrical topology. When `system.json` omits a presentation reference, compilation
returns revision `UNSPECIFIED`, background `#ffffff`, and an empty title-line
array. Successful IR and presentation values are detached and frozen.

## Compiler pipeline

`compileProject` runs one ordered pipeline:

1. strict JSON parsing, schema validation, project/presentation/library loading, and
   E0xx structural checks;
2. library-lock normalization and verification;
3. type catalog and reference resolution with E1xx checks;
4. type expansion, graph normalization, net derivation, and IR assembly;
5. `evaluateRules(ir)`; and
6. diagnostic normalization and the final success/error gate.

An error before IR assembly stops the pipeline. Rule errors return `ok: false` and
never expose partial IR. Warnings return `ok: true` with complete diagnostics, IR,
and presentation. `compileLoadedProject` applies the same post-load pipeline to one
already loaded frozen snapshot.

## Local and shipped libraries

Manifest library dependencies have two compatible forms:

```ts
type ProjectLibraryDependency =
  | { readonly name: string; readonly version: string; readonly path: string }
  | { readonly name: string; readonly version: string };
```

An explicit `path` always selects the existing local-library loader. A dependency
without `path` resolves only the shipped pair `core@0.1.0` from
`@thermite/core-library`. Any other name/version-only request produces E032;
the compiler never consults npm, `NODE_PATH`, cwd ancestors, environment variables,
a user cache, or the network.

Loaded libraries and `IrLibrary` records carry required
`resolutionKind: "local" | "shipped"`. The v1 lock schema accepts the field as
optional for compatibility; absence normalizes to `local` only after successful
schema validation. Every canonical lock writer emits the field. Local entries retain
their authored path; shipped core uses internal provenance locator
`ais-shipped:core@0.1.0`. Stable shipped diagnostic/source paths begin
`@thermite/core-library/` and never reveal an install prefix.

## Presentation loading

The optional manifest `presentation` member names one safe project-contained file.
The loader gives it owner `project`, kind `project_presentation`, stable
project-relative provenance, and schema `project-presentation/0.1`. If a source glob
also matches the same canonical file, that one file is validated only as
presentation. Aliases, reparse escapes, unsafe paths, missing files, and structural
errors are rejected deterministically.

Project-name loader compatibility remains unchanged: `project.name` is still a plain
string under `electrical-system/0.1`. The renderer, not the loader, owns the
additional title renderability boundary.

## Engineering rule catalog

| Code | Severity | Check                                                                                                    |
| ---- | -------- | -------------------------------------------------------------------------------------------------------- |
| E200 | error    | A cable conductor ID is absent from its resolved selected cable type.                                    |
| E201 | error    | A second or later direct conductive element lands on an explicitly `exclusive` terminal.                 |
| E300 | error    | Potential declarations on one net disagree on the name or an overlapping electrical field.               |
| E301 | error    | A coherent net's explicit AC/DC type conflicts with a connected terminal rating.                         |
| E302 | error    | A coherent net's positive nominal voltage conflicts with a connected terminal's positive nominal rating. |
| W902 | warning  | A later potential declaration exactly duplicates an earlier declaration's complete intent.               |

E200/E201-affected nets do not produce dependent potential or rating findings. E300
suppresses E301/E302 on its net, and E301 suppresses E302 only for the same terminal.
Missing policies, declarations, and ratings remain unknown rather than diagnostic.
CLI strictness is an exit policy and does not change warning severity.

## Canonical outputs and downstream consumers

`serializeIr` fixes DTO field order, table/index order, dynamic-key order, two-space
indentation, LF, and one final newline. Newly generated local and shipped IR/lock
provenance explicitly records resolution kind; presentation does not alter electrical
topology.

`@thermite/query` consumes only successful in-memory IR.
`@thermite/render` consumes that same IR plus the successful compiled
presentation. The query package does not rebuild compiler state. The renderer adds
selection, layout, an opaque canvas, visible drawing identity, and SVG without
changing graph or net semantics. Project source contains no schematic coordinates,
symbol geometry, bend points, or saved drawing pages.
