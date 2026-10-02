# Declared physical continuity checks

`continuity` evaluates a saved list of explicit project obligations. Use it to
check that an authored terminal common, direct feed or bond has a modeled
conductive path between two known terminals. The source is unchanged; no
requirements or repairs are inferred.

```sh
bun thermite.mjs continuity --project examples/motor-starter --input examples/motor-starter/continuity.request.json
bun thermite.mjs continuity --project examples/motor-starter --input examples/motor-starter/continuity.request.json --json
bun thermite.mjs continuity --project examples/motor-starter --input examples/motor-starter/continuity.request.json -o out/continuity.json
```

A `continuity-check-request/0.1` requires 1–500 checks with unique nonblank IDs,
a nonblank reason and two explicit terminal selectors. IDs accept up to 120
characters, reasons up to 400, and selector strings up to 2,048; control
characters and extra fields are rejected.
Selectors use exact terminal IDs (`by: "id"`), a device designation and terminal
key (`by: "parts"`), or a terminal display (`by: "display"`), using the existing longest compiled
device-prefix grammar. Prefer explicit IDs or parts for obligations involving
dotted names. The saved
[motor-starter request](../examples/motor-starter/continuity.request.json) shows
terminal commoning and direct positive/return feeds. A file or `--input -` may be
used; output cannot replace the request or authoritative project source.

```json
{
  "format": "continuity-check-request/0.1",
  "checks": [
    {
      "id": "terminal-common",
      "reason": "The declared terminal common requires an explicit modeled path.",
      "from": { "by": "parts", "deviceDesignation": "TB1", "terminalKey": "1" },
      "to": { "by": "parts", "deviceDesignation": "TB1", "terminalKey": "2" }
    }
  ]
}
```

## Results and supported semantics

A `physical-continuity-report/0.1` retains request order and every reason, resolved
terminal identity, display, derived physical net ID and endpoint model-coverage
status. Each check is one of:

| Status | Meaning |
| --- | --- |
| `satisfied` | Two distinct resolved terminals share the same modeled physical net. |
| `missing-modeled-path` | Both terminals resolve, but belong to different modeled physical nets. |
| `indeterminate` | At least one selector cannot be resolved. Query errors identify each unresolved endpoint. |

`passed` is true only when every check is satisfied. Unresolved selectors cannot yield a clean audit. Selecting the same physical terminal twice,
including through different selector forms, is an invalid tautological check.
An invalid request produces no report and leaves an existing output artifact intact.

Exit 0 means every obligation is satisfied. Exit 1 means a missing modeled path,
an indeterminate check, invalid request or authored source failure. A report is
still returned for missing/indeterminate checks. Usage/infrastructure failures
return 2. Compiler diagnostics remain on stderr for the whole project, including
partial-model and missing-required-connection warnings; a continuity result never
clears those warnings. `.json` or `--json` gives structured output, while `.txt`
or default stdout gives a readable summary.

The query package exposes `auditContinuity(ir, request)` for the same pure audit.
The six guarded agent commands keep their existing contracts. Requests are
review inputs, not additional electrical source or library requirements.

Only authored wires, jumpers and fully terminated cable cores join physical nets.
Fully terminated spare cores remain conductive. A single-ended core does not
satisfy continuity. Contacts (even normally closed), coils, windings, channels,
sources, loads and `feeds_internal`/mechanical associations are excluded.

**A missing modeled path is not proof of a physical wiring defect.** A library
may omit fixed internal commoning; represent an established common with the
existing explicit project jumper workflow when justified by evidence. Partial
and unreviewed endpoint model coverage is retained, but does not make a known
modeled path disappear. This check cannot discover hardware terminals omitted
from a model.

Presence, physical continuity and functional supply traversal answer different
questions. Use [`diagnostics`](completeness.md) for declared connection presence.
A continuity obligation across a power supply or contact will fail unless an
actual conductive path is authored, even when a functional supply trace exists.
Do not use this physical audit to test energized behavior, upstream power through
devices, voltage compatibility, adequate protective bonding, ampacity,
coordination or machine safety.
