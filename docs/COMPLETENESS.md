# Connection completeness

`validate` checks source consistency. `diagnostics` adds an inventory of declared
terminals and communication ports, with required connections, review notes and
component-model coverage. It reads the project without changing it.

```sh
bun thermite.mjs diagnostics --project path/to/project
bun thermite.mjs diagnostics --project path/to/project --device HMI1 --json
bun thermite.mjs diagnostics --project path/to/project --location "HMI console"
bun thermite.mjs diagnostics --project path/to/project -o audit.json
bun thermite.mjs diagnostics --project path/to/project -o audit.csv
```

Text groups warnings before information and includes source locations. JSON uses
`electrical-completeness/0.1`: counts, every selected device and connection,
findings, and the analysis limits. CSV includes connected points and a model
coverage row for each device. Device and location filters use exact names and
intersect when combined; an unknown or empty selection fails instead of looking
like a clean audit. Compiler diagnostics remain on stderr for the whole project,
even when the completeness inventory is filtered.

Exit 0 means the audit ran successfully, including warnings. Invalid source or
selection returns 1; usage or infrastructure failures return 2. Existing
`validate --strict` can make compiler warnings fail a check. The six guarded
agent commands retain their existing request and result contracts; an agent can
also invoke `diagnostics --json` to answer completeness questions.

## Library requirements

Mark a terminal or communication port `required: true` when every instance needs
a connection. Terminal `role` remains a descriptive string; neither its spelling
nor a label such as `24V` silently makes a terminal required.

```json
{
  "terminals": {
    "P": { "role": "supply_positive", "required": true },
    "N": { "role": "supply_return", "required": true },
    "IN1": { "role": "digital_input" },
    "IN2": { "role": "digital_input" }
  },
  "connectionCoverage": {
    "status": "partial",
    "notes": "Signal and DC power terminals are modeled; protective bonding connector still needs review."
  }
}
```

This is a fragment of a device type. `connectionCoverage` is optional for older
libraries, but new library contributions should declare it. `complete` means the
author has reviewed and modeled every physical terminal and communication port
for the exact part, including power, returns, protective earth, shields,
connectors and optional interfaces. It does not mean every pin must be used.
`partial` must explain what is missing. Both statuses require nonblank `notes`.
Absence is reported as **unreviewed**, never silently treated as complete.

For example, a port-only HMI model must be partial until its power connector and
bonding are modeled from evidence. The diagnostic cannot discover pins omitted
from the library. A generic or proposed interface is not an exact manufacturer
pinout; keep that distinction in its coverage notes and modeling documentation.

After a library edit, intentionally regenerate its project lock and validate.
Visible libraries already copied into a project do not update automatically.

## Project-specific requirements and review

Use `connectionReview` on a device for application-dependent connections:

```json
{
  "connectionReview": {
    "terminals": {
      "IN1": {
        "status": "required",
        "reason": "This application uses the pressure permissive input."
      },
      "IN2": {
        "status": "intentionally-unused",
        "reason": "Reserved for a future temperature switch."
      },
      "P": {
        "status": "deferred",
        "reason": "Field cable is drawn; upstream fused supply is still pending."
      }
    },
    "ports": {
      "ETH2": {
        "status": "intentionally-unused",
        "reason": "This application uses only ETH1."
      }
    }
  }
}
```

Every entry needs a nonblank reason and must name an existing terminal or port.
`required` promotes an application-dependent connection to required. An unused
or deferred entry cannot override a library requirement. Deferred work remains a
warning even if a conductor is attached; it may describe an unfinished upstream
feed. Remove or revise the review entry when that work is completed. An unused
entry that acquires a connection is also flagged for review.

Use the guarded patch workflow for these device-source edits. Do not classify
an unconnected point as unused merely to clear the report.

## Findings and limits

| Code | Meaning |
| --- | --- |
| E205 | Device review names an undeclared terminal or port; source error. |
| W903 | Required connection missing or only a single-ended cable core attached. |
| W904 | Component connection model is explicitly partial. |
| W905 | Deferred work, or an unused review contradicts a requirement or connection. |
| I001 | Unconnected or dangling point without a declared requirement or unused disposition. |
| I002 | Intentionally unused point, with its reason preserved. |
| I003 | Component connection coverage has not been declared. |

W903–W905 also appear during compilation and agent validation. Compiler warnings
aggregate each device/code while preserving the individual definition references;
the completeness report keeps individual findings. Information codes belong to
the completeness inventory and do not introduce warnings in legacy validation.

**Connected means connection presence only.** Wires, jumpers and fully terminated
cable cores qualify. A core with an unfinished far end occupies a terminal but
does not satisfy a required connection. A completely terminated spare core is
still conductive. A device function does not short its terminals or supply its
loads. Communication relations satisfy port topology, but do not prove that a
physical network cable has been scheduled.

This analysis does not yet prove an upstream supply path, adequate power,
protective bonding, conductor ampacity, fuse/breaker coordination, or machine
safety. A device can have every pin connected and still need an upstream feed.
Coverage declarations and review notes make those limits visible in the source.

The executable [completeness fixture](../packages/cli/fixtures/completeness/source.json)
demonstrates required, dangling, unused and deferred cases, including a port-only
HMI. Its deliberately unfinished connections are diagnostic examples.
